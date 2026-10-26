import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

test('find and replace changes the checked matches in one undo step', async ({ page }) => {
  await loadDemo(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>find and replace');
  await page.keyboard.press('Enter');
  await page.getByTestId('replace-find').fill('the table');
  await page.getByTestId('replace-with').fill('the bench');
  await expect(page.getByTestId('replace-row')).toHaveCount(1);
  await page.getByTestId('replace-apply').click();
  await page.keyboard.press('Escape');

  await openScene(page, 'Supper at the Inn');
  const editor = page.getByTestId('scene-editor').locator('.cm-content');
  await expect(editor).toContainText('Across the bench');
  await expect(editor).toContainText('[[norman]]'); // untouched

  await page.getByTestId('undo').click();
  await expect(editor).toContainText('Across the table');
  await expect(editor).not.toContainText('Across the bench');
});
