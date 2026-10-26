import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

// "?" opens the cheat sheet, but never steals the character while the writer is typing.
test.describe('keyboard cheat sheet', () => {
  test('? opens it and Esc closes it; typing ? in the editor writes a ?', async ({ page }) => {
    await loadDemo(page);
    await page.locator('body').press('?');
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);

    await openScene(page, 'The Fall of Ashford');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.type('Really?');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    await expect(page.getByTestId('scene-editor').locator('.cm-content')).toContainText('Really?');
  });

  test('the palette lists it', async ({ page }) => {
    await loadDemo(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('>keyboard shortcuts');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  });
});
