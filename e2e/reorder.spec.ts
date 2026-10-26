import { expect, test, type Page } from '@playwright/test';
import { clip, loadDemo } from './helpers';

const outlineScenes = (page: Page) => page.getByTestId('side-scene').locator('.lp-row-name').allTextContents();

test('dragging a scene in the outline changes reading order and leaves story time alone', async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId('outline-toggle-all').click();
  const before = await outlineScenes(page);
  const first = before[0];
  const last = before[before.length - 1];
  const box = async (title: string) => (await clip(page, title).boundingBox())!.x;
  const lastX = await box(last);

  const rows = page.getByTestId('side-scene');
  await rows.filter({ hasText: last }).dragTo(rows.filter({ hasText: first }), { targetPosition: { x: 20, y: 2 } });

  await expect.poll(() => outlineScenes(page)).toEqual([last, ...before.slice(0, -1)]);
  await expect(page.getByText('Reading order changed. Story time unchanged.').first()).toBeVisible();
  expect(await box(last)).toBe(lastX); // the clip did not move on the timeline
});

test('a scene dropped on a chapter joins its end, and Alt+Up / Alt+Down then move it within the chapter, keeping focus', async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId('outline-toggle-all').click();
  const rows = page.getByTestId('side-scene');
  await rows.filter({ hasText: 'The Stranger' }).dragTo(page.locator('.lp-chapter').filter({ hasText: 'Chapter 1' }));
  await expect.poll(() => outlineScenes(page)).toEqual(['Supper at the Inn', 'The Stranger', 'The Betrayal', 'Gathering Storm', 'The Fall of Ashford']);
  const stranger = rows.filter({ hasText: 'The Stranger' });
  await stranger.focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(async () => (await outlineScenes(page)).slice(0, 2)).toEqual(['The Stranger', 'Supper at the Inn']);
  await expect(stranger).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(async () => (await outlineScenes(page)).slice(0, 2)).toEqual(['Supper at the Inn', 'The Stranger']);
});

test('dragging a chapter row onto another reorders the chapters', async ({ page }) => {
  await loadDemo(page);
  const chapters = page.getByTestId('outline-chapter-row');
  const titles = async () => (await chapters.locator('.lp-row-name').allTextContents()).map((t) => t.trim());
  const before = await titles();
  expect(before.length).toBeGreaterThan(1);
  await chapters.last().dragTo(chapters.first(), { targetPosition: { x: 60, y: 2 } });
  await expect.poll(titles).toEqual([before[before.length - 1], ...before.slice(0, -1)]);
});
