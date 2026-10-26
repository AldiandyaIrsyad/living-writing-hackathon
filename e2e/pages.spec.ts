import { expect, test, type Page } from '@playwright/test';
import { hoverLink, loadDemo, openEntity, openScene, openCastCard } from './helpers';

// Living pages: an entity's page and name are git-tracked over story time. A revision is a
// 'revise' change committed at a scene; the page reads as it stands at the selected time.

/** Scrub an entity page to "just after <scene>" (picked by scene title). */
async function scrubAfter(page: Page, sceneTitle: string): Promise<void> {
  const select = page.getByTestId('time-select');
  const value = await select.locator('option').filter({ hasText: `After “${sceneTitle}”` }).first().getAttribute('value');
  if (!value) throw new Error(`no time option for “${sceneTitle}”`);
  await select.selectOption(value);
}

test.describe('living pages', () => {
  test("Mira's page lacks the haircut before Gathering Storm and has it after", async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Mira');
    await scrubAfter(page, 'The Stranger');
    await expect(page.getByTestId('page-time')).toContainText('Base page');
    await expect(page.getByTestId('note-preview')).not.toContainText('cut her hair short');

    await scrubAfter(page, 'Gathering Storm');
    await expect(page.getByTestId('page-time')).toContainText('Page as of Gathering Storm · revised in Gathering Storm');
    await expect(page.getByTestId('note-preview')).toContainText('cut her hair short');
  });

  test('Norman: revise from the Cast, see the diff and rename, then revise again later', async ({ page }) => {
    await loadDemo(page);

    // Brown hair and a new name, committed at "Supper at the Inn" from the scene's Cast.
    await openScene(page, 'Supper at the Inn');
    await (await openCastCard(page, 'Norman')).getByTestId('cast-update-page').click();
    await expect(page.getByTestId('revision-bar')).toContainText('Supper at the Inn');
    const editor = page.getByTestId('revision-editor');
    await editor.fill(`${await editor.inputValue()}\n\nHas brown hair`);
    await page.getByTestId('revision-rename').fill('Norman the Bold');
    await page.getByTestId('revision-message').fill('Brown hair, and a new name');
    await page.getByTestId('revision-commit').click();
    await expect(page.getByTestId('revision-bar')).toHaveCount(0);
    await expect(page.getByTestId('page-time')).toContainText('revised after column 1');
    await expect(page.getByTestId('entity-name')).toHaveValue('Norman the Bold');
    await expect(page.getByTestId('note-preview')).toContainText('Has brown hair');

    // The history shows the revision: its message, the rename and an expandable diff.
    const entry = page.getByTestId('history-entry').filter({ hasText: 'Brown hair, and a new name' });
    await expect(entry.getByTestId('history-rename')).toHaveText('renamed Norman → Norman the Bold');
    await entry.locator('summary').click();
    await expect(entry.locator('.diff-add', { hasText: 'Has brown hair' })).toBeVisible();

    // Later the hair goes green, committed at "The Fall of Ashford" from that scene's Cast.
    await openScene(page, 'The Fall of Ashford');
    await (await openCastCard(page, 'Norman')).getByTestId('cast-update-page').click();
    await expect(page.getByTestId('revision-editor')).toContainText('Has brown hair');
    const later = page.getByTestId('revision-editor');
    await later.fill((await later.inputValue()).replace('Has brown hair', 'Has green hair'));
    await page.getByTestId('revision-message').fill('Hair has gone green');
    await page.getByTestId('revision-commit').click();
    await expect(page.getByTestId('revision-bar')).toHaveCount(0);
    await expect(page.getByTestId('note-preview')).toContainText('Has green hair');

    // Earlier in the story the page still reads brown; at latest it reads green.
    await scrubAfter(page, 'Supper at the Inn');
    await expect(page.getByTestId('note-preview')).toContainText('Has brown hair');
    await expect(page.getByTestId('note-preview')).not.toContainText('Has green hair');
    await page.getByTestId('time-select').selectOption('latest');
    await expect(page.getByTestId('note-preview')).toContainText('Has green hair');
    await expect(page.getByTestId('note-preview')).not.toContainText('Has brown hair');
    await expect(page.getByTestId('entity-name')).toHaveValue('Norman the Bold');
  });

  test('after the rename, [[Norman]] in a later scene hovers as Norman the Bold', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await (await openCastCard(page, 'Norman')).getByTestId('cast-update-page').click();
    await page.getByTestId('revision-rename').fill('Norman the Bold');
    await page.getByTestId('revision-message').fill('Earns a name');
    await page.getByTestId('revision-commit').click();
    await expect(page.getByTestId('revision-bar')).toHaveCount(0);

    await openScene(page, 'The Stranger');
    await hoverLink(page, 'Norman');
    await expect(page.getByTestId('hovercard')).toContainText('Norman the Bold');
  });

  test('a line added to the base page is offered to the later version, previewed, and added on confirm', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Mira');
    await page.getByTestId('time-select').selectOption('start');
    await page.getByTestId('edit-base-page').click();
    const editor = page.getByTestId('revision-editor');
    await editor.fill(`${await editor.inputValue()}\n\nHas green eyes.`);
    await page.getByTestId('revision-commit').click();

    // Nothing is written yet: the later version is previewed with the line it would get.
    const version = page.getByTestId('propagate-version').filter({ hasText: 'Gathering Storm' });
    await expect(version.locator('.diff-add', { hasText: 'Has green eyes.' })).toBeVisible();
    await page.getByTestId('propagate-apply').click();
    await expect(page.getByTestId('propagate-preview')).toHaveCount(0);

    await scrubAfter(page, 'The Stranger');
    await expect(page.getByTestId('note-preview')).toContainText('Has green eyes.');
    await scrubAfter(page, 'Gathering Storm');
    await expect(page.getByTestId('note-preview')).toContainText('cut her hair short');
    await expect(page.getByTestId('note-preview')).toContainText('Has green eyes.');
  });

  test('a base page is edited in place until a revision exists; Cancel discards a draft', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    await expect(page.getByTestId('page-time')).toHaveText('Base page');
    await page.getByTestId('note-edit').click();
    await expect(page.getByTestId('note-editor')).toBeVisible();

    await scrubAfter(page, 'The Stranger');
    await page.getByTestId('revise-page').click();
    await expect(page.getByTestId('revision-bar')).toContainText('The Stranger');
    await page.getByTestId('revision-editor').fill('Something else entirely.');
    await page.getByTestId('revision-cancel').click();
    await expect(page.getByTestId('revision-bar')).toHaveCount(0);
    await expect(page.getByTestId('history-entry')).toHaveCount(1);
  });
});
