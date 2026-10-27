import { expect, test } from '@playwright/test';
import { loadDemo } from './helpers';

// The Timetable look numbers scenes like the palette's go-to addresses (:4.1), and the earlier look stays a setting.

test.describe('look', () => {
  test('outline scenes carry their chapter.scene address; Classic hides it and survives a reload', async ({ page }) => {
    await loadDemo(page);
    await page.getByRole('button', { name: 'Expand all' }).click();
    const row = page.getByTestId('side-scene').filter({ hasText: 'Gathering Storm' });
    await expect(row.locator('.lp-addr')).toHaveText('4.01');
    await expect(page.locator('html')).toHaveAttribute('data-look', 'timetable');

    await page.keyboard.press('Control+k');
    await page.getByTestId('switcher-input').fill('>Toggle look');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-look', 'classic');
    await expect(row.locator('.lp-addr')).toBeHidden();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-look', 'classic');
  });
});
