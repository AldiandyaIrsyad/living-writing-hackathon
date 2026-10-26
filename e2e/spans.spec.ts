import { expect, test, type Locator, type Page } from '@playwright/test';
import { clip, loadDemo } from './helpers';

// Stretched clips (spans) and "during" drops: a clip dropped inside a stretched clip lands at that clip's
// start, middle or end column, and two clips can bracket it. Also the range bar's zoom limits.

const MIRA_TRACK = '[data-testid="tl-track"][data-story="Mira\'s Road"]';

/** Pixels per column, read from the lane's --col variable (the clip is a child of its lane). */
async function zoomOf(scene: Locator): Promise<number> {
  return scene.evaluate((el) => parseFloat(getComputedStyle(el.parentElement!).getPropertyValue('--col')));
}

/** Stretch a clip to `columns` columns by dragging its right-edge stretch handle (as a user would). */
async function stretch(page: Page, title: string, columns: number): Promise<void> {
  const scene = clip(page, title);
  await scene.hover();
  const zoom = await zoomOf(scene);
  const handle = scene.getByTestId('tl-clip-resize');
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no stretch handle on “${title}”`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (columns - 1) * zoom, y, { steps: 6 });
  await page.mouse.up();
  await expect(scene).toHaveAttribute('data-span', String(columns));
}

/**
 * Drag a clip onto column `k` (counted from 0) of a stretched clip. The pointer goes to
 * the middle of that column, which is inside the stretched clip's "during" zone.
 */
async function dropDuring(source: Locator, target: Locator, k: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('drop target has no box');
  const zoom = await zoomOf(target);
  // The clip's left edge sits 2px inside its first column.
  const x = (k + 0.5) * zoom - 2;
  expect(x).toBeLessThan(box.width);
  await source.dragTo(target, { targetPosition: { x, y: box.height / 2 } });
}

async function columnOf(page: Page, title: string): Promise<number> {
  return Number(await clip(page, title).getAttribute('data-column'));
}

test.describe('stretched clips: dropping inside a span', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('mode-move').click();
    await stretch(page, 'The Stranger', 3);
  });

  test('a scene dropped at the start of a stretched clip starts in its first column', async ({ page }) => {
    const start = await columnOf(page, 'The Stranger');
    await dropDuring(clip(page, 'Crossroads'), clip(page, 'The Stranger'), 0);
    await expect(clip(page, 'Crossroads')).toHaveAttribute('data-column', String(start));
    await expect(clip(page, 'The Stranger')).toHaveAttribute('data-span', '3');
    await expect(clip(page, 'The Stranger')).toHaveAttribute('data-column', String(start));
  });

  test('a scene dropped in the middle of a stretched clip starts one column in', async ({ page }) => {
    const start = await columnOf(page, 'The Stranger');
    await dropDuring(clip(page, 'Crossroads'), clip(page, 'The Stranger'), 1);
    await expect(clip(page, 'Crossroads')).toHaveAttribute('data-column', String(start + 1));
    await expect(clip(page, 'The Stranger')).toHaveAttribute('data-column', String(start));
  });

  test('a scene dropped at the end of a stretched clip starts in its last column', async ({ page }) => {
    const start = await columnOf(page, 'The Stranger');
    await dropDuring(clip(page, 'Crossroads'), clip(page, 'The Stranger'), 2);
    await expect(clip(page, 'Crossroads')).toHaveAttribute('data-column', String(start + 2));
  });

  test('two Mira\'s Road scenes at the start and the end leave the middle of the stretched clip empty', async ({ page }) => {
    const start = await columnOf(page, 'The Stranger');
    await dropDuring(clip(page, 'Crossroads'), clip(page, 'The Stranger'), 0);
    await expect(clip(page, 'Crossroads')).toHaveAttribute('data-column', String(start));

    await dropDuring(clip(page, 'The Sword in the Ash'), clip(page, 'The Stranger'), 2);
    await expect(clip(page, 'The Sword in the Ash')).toHaveAttribute('data-column', String(start + 2));

    // Mira's Road has nothing in the middle column; the main story is untouched.
    await expect(page.locator(`${MIRA_TRACK} [data-testid="tl-scene"][data-column="${start + 1}"]`)).toHaveCount(0);
    await expect(clip(page, 'The Stranger')).toHaveAttribute('data-span', '3');
    await expect(clip(page, 'The Stranger')).toHaveAttribute('data-column', String(start));
  });
});

test.describe('the range bar limits', () => {
  test('zooming out stops at fit-all: dragging the end handle past the whole work leaves the window filling the bar', async ({ page }) => {
    await loadDemo(page);
    const bar = (await page.locator('.tl-range-inner').boundingBox())!;
    const end = page.getByTestId('tl-range-end');
    const box = (await end.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width + 300, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const win = page.getByTestId('tl-range-window');
    await expect(win).toHaveAttribute('data-fit', 'true');
    const w = (await win.boundingBox())!;
    expect(Math.abs(w.x - bar.x)).toBeLessThan(1);
    expect(Math.abs(w.width - bar.width)).toBeLessThan(1);
    await expect(page.getByTestId('tl-range-shade-start')).toHaveCount(1);
    expect((await page.getByTestId('tl-range-shade-start').boundingBox())!.width).toBeLessThan(1);
    expect((await page.getByTestId('tl-range-shade-end').boundingBox())!.width).toBeLessThan(1);
  });

  test('zoomed in, the area outside the window is shaded; fit-all shows the whole bar as the window', async ({ page }) => {
    await loadDemo(page);
    const bar = (await page.locator('.tl-range-inner').boundingBox())!;
    const end = page.getByTestId('tl-range-end');
    const box = (await end.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByTestId('tl-range-window')).toHaveAttribute('data-fit', 'false');
    await expect.poll(async () => (await page.getByTestId('tl-range-shade-end').boundingBox())?.width ?? 0).toBeGreaterThan(bar.width * 0.3);

    await page.getByTestId('tl-rangebar').dblclick();
    await expect(page.getByTestId('tl-range-window')).toHaveAttribute('data-fit', 'true');
  });
});
