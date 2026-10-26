import { expect, test } from '@playwright/test';
import { loadDemo, waitSaved } from './helpers';

test('the save dot opens one answer to "is my work safe?", with the places the work lives and a backup button', async ({ page }) => {
  await loadDemo(page);
  await waitSaved(page);
  await page.getByTestId('save-status').click();
  const popover = page.getByTestId('save-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Saved to this browser');
  await expect(popover).toContainText('No folder connected');
  await expect(popover.getByRole('button', { name: /Back up now/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
});
