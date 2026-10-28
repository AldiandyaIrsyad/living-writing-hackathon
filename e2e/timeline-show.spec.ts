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

test.describe('cancelling a drag', () => {
  test('dropping a scene back on itself changes nothing and shows no error', async ({ page }) => {
    await loadDemo(page);
    const supper = clip(page, 'Supper at the Inn');
    const column = await supper.getAttribute('data-column');
    // Pick it up, carry it over another scene, then bring it back and let go on itself.
    const from = (await supper.boundingBox())!;
    const away = (await clip(page, 'The Stranger').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(away.x + away.width / 2, away.y + away.height / 2, { steps: 8 });
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('toast-error')).toHaveCount(0);
    await expect(supper).toHaveAttribute('data-column', column!);
    await expect(page.locator('.tl-drop')).toHaveCount(0);
  });
});
