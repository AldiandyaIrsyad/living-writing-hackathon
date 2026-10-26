import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

test('a pinned Inspector keeps describing its scene while another scene is open, until unpinned', async ({ page }) => {
  await loadDemo(page);
  await openScene(page, 'The Stranger');
  const scene = page.getByTestId('insp-scene');
  await expect(scene).toContainText('The Stranger');
  await page.getByTestId('insp-pin').click();
  await expect(page.getByTestId('insp-pin-chip')).toHaveText('as of Chapter 2 · The Stranger');

  await openScene(page, 'The Betrayal');
  await expect(scene).toContainText('The Stranger');
  await expect(scene).not.toContainText('The Betrayal');
  await expect(page.getByTestId('insp-pin-chip')).toHaveText('as of Chapter 2 · The Stranger');

  await page.getByTestId('insp-pin').click();
  await expect(page.getByTestId('insp-pin-chip')).toHaveCount(0);
  await expect(scene).toContainText('The Betrayal');
});
