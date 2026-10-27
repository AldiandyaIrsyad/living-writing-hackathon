import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

// Names of pages are suggested while writing, like an IDE: Tab links one, Enter stays a new line.

test.describe('name suggestions', () => {
  test('Tab turns the suggested name into a link, and Enter just starts a new line', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    const editor = page.getByTestId('scene-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');

    await page.keyboard.type(' Then Norm');
    await expect(page.locator('.cm-tooltip-autocomplete li').filter({ hasText: 'Norman' })).toBeVisible();
    await page.waitForTimeout(150); // CodeMirror ignores a key sent within 75 ms of the popup opening
    await page.keyboard.press('Tab');
    await expect(editor).toContainText('Then [[Norman]]');

    await page.keyboard.type(' sat. Mir');
    await expect(page.locator('.cm-tooltip-autocomplete li').filter({ hasText: 'Mira' })).toBeVisible();
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
    await expect(editor).toContainText('sat. Mir');
    await expect(editor).not.toContainText('[[Mira]]');
    await expect(editor.locator('.cm-line').last()).toHaveText('');
  });
});
