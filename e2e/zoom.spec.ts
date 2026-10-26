import { expect, test } from '@playwright/test';
import { clip, loadDemo } from './helpers';

// Keyboard zoom on the timeline (zoom contract: the playhead stays put, 0 fits, Z frames the chapter).
test.describe('timeline keyboard zoom', () => {
  test('1 makes scenes comfortably wide, 0 fits the whole work again, Z frames the chapter at the playhead', async ({ page }) => {
    await loadDemo(page);
    const timeline = page.getByTestId('timeline');
    const supper = clip(page, 'Supper at the Inn');
    const fitted = (await supper.boundingBox())!.width;

    await clip(page, 'Supper at the Inn').click();
    await timeline.focus();
    await page.keyboard.press('1');
    await expect.poll(async () => (await supper.boundingBox())?.width ?? 0).toBeGreaterThan(fitted * 1.3);

    await page.keyboard.press('0');
    await expect.poll(async () => Math.round((await supper.boundingBox())?.width ?? 0)).toBe(Math.round(fitted));

    // Framing the chapter makes its band fill most of the lane, which at fit-all it does not.
    const band = page.locator('[data-testid="tl-chapter"]').first();
    const chapterAtFit = (await band.boundingBox())!.width;
    await page.keyboard.press('z');
    await expect.poll(async () => (await band.boundingBox())?.width ?? 0).toBeGreaterThan(chapterAtFit * 2);
  });

  test('Alt+[ goes back to the view before a jump, Alt+] forward again', async ({ page }) => {
    await loadDemo(page);
    const supper = clip(page, 'Supper at the Inn');
    const width = async () => Math.round((await supper.boundingBox())?.width ?? 0);
    const fitted = await width();
    await page.getByTestId('timeline').focus();
    await page.keyboard.press('1');
    await expect.poll(width).toBeGreaterThan(fitted * 1.3);
    const scenes = await width();

    await page.keyboard.press('0'); // a jump back out to fit-all
    await expect.poll(width).toBe(fitted);
    await page.keyboard.press('Alt+[');
    await expect.poll(width).toBe(scenes);
    await page.keyboard.press('Alt+]');
    await expect.poll(width).toBe(fitted);

    // The toolbar arrows do the same: Back is enabled now, and returns to the scene-size view.
    await page.getByTestId('tl-view-back').click();
    await expect.poll(width).toBe(scenes);
    await page.getByTestId('tl-view-forward').click();
    await expect.poll(width).toBe(fitted);
  });

  test('double-clicking a chapter band frames that chapter', async ({ page }) => {
    await loadDemo(page);
    const band = page.locator('[data-testid="tl-chapter"]').first();
    const atFit = (await band.boundingBox())!.width;
    await band.dblclick();
    await expect.poll(async () => (await band.boundingBox())?.width ?? 0).toBeGreaterThan(atFit * 2);
  });
});
