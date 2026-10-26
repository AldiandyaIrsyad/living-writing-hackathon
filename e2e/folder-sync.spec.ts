import { expect, test, type Page } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

// Folder sync must notice edits made outside the app and never overwrite them. The "folder" is the browser's private
// file system (OPFS), which behaves like a picked folder, so the test needs no dialog.

async function connectFakeFolder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('sync-test', { create: true });
    };
  });
  await loadDemo(page);
  await page.getByRole('button', { name: 'Sync to folder…' }).click();
  await expect(page.getByTestId('folder-sync')).toHaveAttribute('data-status', 'synced');
}

/** Reads, or (with `change`) rewrites, the scene file whose name contains `title`. Returns the text it had. */
function sceneFile(page: Page, title: string, change?: (text: string) => string): Promise<string> {
  const edit = change?.toString();
  return page.evaluate(
    async ({ title, edit }) => {
      const find = async (dir: FileSystemDirectoryHandle): Promise<FileSystemFileHandle | null> => {
        for await (const entry of dir.values()) {
          if (entry.kind === 'file' && entry.name.includes(title)) return entry as FileSystemFileHandle;
          if (entry.kind === 'directory' && entry.name !== '.living-writing-backup') {
            const hit = await find(entry as FileSystemDirectoryHandle);
            if (hit) return hit;
          }
        }
        return null;
      };
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sync-test');
      const handle = (await find(root))!;
      const text = await (await handle.getFile()).text();
      if (edit) {
        const w = await handle.createWritable();
        await w.write((0, eval)(`(${edit})`)(text));
        await w.close();
      }
      return text;
    },
    { title, edit },
  );
}

/** The cursor to the start of the line `down` lines below the heading (typing in the heading would rename the scene, and its file). */
async function toLineBelowHeading(page: Page, down: number): Promise<void> {
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown', { delay: 0 });
  for (let i = 1; i < down; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
}

/** Makes the app look at the folder now instead of at its next 8-second check. */
const lookNow = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test.describe('folder sync notices outside edits', () => {
  test('an edit made outside is picked up, and Undo puts it back', async ({ page }) => {
    await connectFakeFolder(page);
    await sceneFile(page, 'Supper at the Inn', (t) => `${t.trimEnd()}\n\nWritten in another editor.\n`);
    await lookNow(page);
    await expect(page.getByTestId('toast-info').filter({ hasText: 'Picked up changes made outside the app' })).toBeVisible();

    await openScene(page, 'Supper at the Inn');
    await expect(page.getByTestId('scene-editor').locator('.cm-content')).toContainText('Written in another editor.');
    await page.keyboard.press('Escape');
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('scene-editor').locator('.cm-content')).not.toContainText('Written in another editor.');
  });

  test('edits in different places of the same scene, one here and one outside, are merged', async ({ page }) => {
    await connectFakeFolder(page);
    await openScene(page, 'Supper at the Inn');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await toLineBelowHeading(page, 1);
    await page.keyboard.type('Typed here. ');
    // Before the app has had its second of quiet to save, the same file changes outside.
    await sceneFile(page, 'Supper at the Inn', (t) => `${t.trimEnd()}\n\nWritten in another editor.\n`);
    await lookNow(page);

    await expect(page.getByTestId('toast-info').filter({ hasText: 'Picked up changes made outside the app' })).toBeVisible();
    await expect(page.getByTestId('folder-conflicts')).toHaveCount(0);
    await expect(page.getByTestId('scene-editor').locator('.cm-content')).toContainText('Typed here.');
    await expect(page.getByTestId('scene-editor').locator('.cm-content')).toContainText('Written in another editor.');
    await expect(page.getByTestId('folder-sync')).toHaveAttribute('data-status', 'synced');
    const onDisk = await sceneFile(page, 'Supper at the Inn');
    expect(onDisk).toContain('Typed here.');
    expect(onDisk).toContain('Written in another editor.');
  });

  test('edits to the same line wait for a choice, nothing is written meanwhile, and the other version is kept in a backup', async ({ page }) => {
    await connectFakeFolder(page);
    const firstLine = (t: string) => t.split('\n').find((l) => l.includes('is eating his food'))!;
    const original = firstLine(await sceneFile(page, 'Supper at the Inn'));
    await openScene(page, 'Supper at the Inn');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await toLineBelowHeading(page, 2); // the first line of prose, which the outside edit changes too
    await page.keyboard.type('Mine. ');
    await sceneFile(page, 'Supper at the Inn', (t) => t.replace('[[norman]] is eating', 'THEIRS [[norman]] is eating'));
    await lookNow(page);

    const banner = page.getByTestId('folder-conflicts');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('folder-sync')).toHaveAttribute('data-status', 'changed');
    await page.waitForTimeout(1500); // longer than the app's save delay: the folder must still hold the outside version
    expect(firstLine(await sceneFile(page, 'Supper at the Inn'))).toBe(`THEIRS ${original}`);

    await banner.getByRole('button', { name: 'Keep mine' }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => firstLine(await sceneFile(page, 'Supper at the Inn'))).toBe(`Mine. ${original}`);
    const kept = await page.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sync-test');
      const backups = await root.getDirectoryHandle('.living-writing-backup');
      let found = false;
      const walk = async (dir: FileSystemDirectoryHandle): Promise<void> => {
        for await (const e of dir.values()) {
          if (e.kind === 'directory') await walk(e as FileSystemDirectoryHandle);
          else if (e.name.includes('Supper') && (await (await (e as FileSystemFileHandle).getFile()).text()).includes('THEIRS ')) found = true;
        }
      };
      await walk(backups);
      return found;
    });
    expect(kept).toBe(true);
  });
});
