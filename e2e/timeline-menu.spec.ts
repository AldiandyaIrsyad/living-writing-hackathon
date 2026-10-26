import { expect, test } from '@playwright/test';
import { clip, loadDemo } from './helpers';

test.describe('timeline minimize tab', () => {
  test('the tab on the timeline top edge tucks the timeline into its strip, and the strip brings it back', async ({ page }) => {
    await loadDemo(page);
    await expect(page.getByTestId('timeline')).toBeVisible();
    await page.getByTestId('tl-minimize').click();
    await expect(page.getByTestId('timeline')).toHaveCount(0);
    await expect(page.getByTestId('tl-minimize')).toHaveCount(0);
    await page.getByTestId('tl-strip').click();
    await expect(page.getByTestId('timeline')).toBeVisible();
  });
});

test.describe('timeline right-click menu', () => {
  test('insert a gap before a scene pushes it right, and the ruler can close the empty column again', async ({ page }) => {
    await loadDemo(page);
    const stranger = clip(page, 'The Stranger');
    const col = Number(await stranger.getAttribute('data-column'));

    await stranger.click({ button: 'right' });
    await page.getByTestId('tl-context-item').filter({ hasText: 'Insert gap before this scene' }).click();
    await expect(stranger).toHaveAttribute('data-column', String(col + 1));

    // Right-click the ruler inside the empty column, just left of the pushed scene.
    const ruler = page.getByTestId('tl-ruler');
    const [r, c] = [await ruler.boundingBox(), await stranger.boundingBox()];
    await ruler.click({ button: 'right', position: { x: c!.x - r!.x - 15, y: 8 } });
    await page.getByTestId('tl-context-item').filter({ hasText: 'Remove empty column' }).click();
    await expect(stranger).toHaveAttribute('data-column', String(col));
  });

  test('insert a gap before the very first scene pushes everything right, and the ruler closes it again', async ({ page }) => {
    await loadDemo(page);
    const first = clip(page, 'Supper at the Inn');
    await expect(first).toHaveAttribute('data-column', '0');
    await first.click({ button: 'right' });
    await page.getByTestId('tl-context-item').filter({ hasText: 'Insert gap before this scene' }).click();
    await expect(first).toHaveAttribute('data-column', '1');

    const ruler = page.getByTestId('tl-ruler');
    const [r, c] = [await ruler.boundingBox(), await first.boundingBox()];
    await ruler.click({ button: 'right', position: { x: c!.x - r!.x - 15, y: 8 } });
    await page.getByTestId('tl-context-item').filter({ hasText: 'Remove empty column' }).click();
    await expect(first).toHaveAttribute('data-column', '0');
  });
});
