import { expect, test } from '@playwright/test';
import { clip, loadDemo } from './helpers';

// What the timeline draws on a story track is the writer's choice: arcs, chapters and scenes each switch off.

test.describe('timeline show settings', () => {
  test('arcs, chapters and scenes can each be hidden, shrinking the track, and stay hidden after a reload', async ({ page }) => {
    await loadDemo(page);
    const main = page.getByTestId('tl-track').filter({ hasText: 'The Ashford Chronicle' });
    const full = (await main.boundingBox())!.height;
    await expect(page.getByTestId('tl-arc').first()).toBeVisible();

    await page.getByTestId('tl-settings').click();
    await page.getByTestId('tl-show-arcs').click();
    await expect(page.getByTestId('tl-arc')).toHaveCount(0);
    await expect(page.getByTestId('tl-chapter').first()).toBeVisible();
    await page.getByTestId('tl-show-chapters').click();
    await expect(page.getByTestId('tl-chapter')).toHaveCount(0);
    await expect(clip(page, 'Supper at the Inn')).toBeVisible();
    expect((await main.boundingBox())!.height).toBeLessThan(full);

    await page.getByTestId('tl-show-scenes').click();
    await expect(page.getByTestId('tl-scene')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('tl-track').first()).toBeVisible();
    await expect(page.getByTestId('tl-scene')).toHaveCount(0);
    await expect(page.getByTestId('tl-chapter')).toHaveCount(0);
  });

  test('a scene clip shows its chapter.scene address instead of repeating the chapter title', async ({ page }) => {
    await loadDemo(page);
    const c = clip(page, 'The Stranger');
    await expect(c).toContainText('2.01');
    await expect(c.locator('.tl-clip-meta')).not.toContainText('Chapter 2');
  });
});

test.describe('story track order', () => {
  test('dragging a story onto the lower half of another story puts it below, and undo puts it back', async ({ page }) => {
    await loadDemo(page);
    const tracks = page.getByTestId('tl-track');
    await expect(tracks.first()).toHaveAttribute('data-story', 'The Ashford Chronicle');

    const mira = page.getByTestId('tl-story').filter({ hasText: "Mira's Road" });
    const box = (await mira.boundingBox())!;
    await page.getByTestId('tl-story').filter({ hasText: 'The Ashford Chronicle' }).dragTo(mira, { targetPosition: { x: 60, y: box.height - 4 } });
    await expect(tracks.first()).toHaveAttribute('data-story', "Mira's Road");

    await page.keyboard.press('Control+z');
    await expect(tracks.first()).toHaveAttribute('data-story', 'The Ashford Chronicle');
  });
});
