import { expect, test } from '@playwright/test';

// Contract: when the saved vault cannot be opened the writer gets a recovery screen, not an empty starter world
// that the next autosave would write over their data.
test('an unreadable database shows the recovery screen instead of an empty world', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error('simulated: database unavailable');
    };
  });
  await page.goto('/');
  const recovery = page.getByTestId('recovery');
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('simulated: database unavailable');
  await expect(page.getByTestId('recovery-dump')).toBeVisible();
  await expect(page.locator('.left-pane')).toHaveCount(0);
});
