import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

// The top bar counts the words written today, net of deletions, and does not count a pasted-in draft.
test('the top bar counts words typed today, and ignores a big paste', async ({ page }) => {
  await loadDemo(page);
  await openScene(page, 'The Fall of Ashford');
  await expect(page.getByTestId('today-badge')).toHaveCount(0);

  const editor = page.getByTestId('scene-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nOne two three four five.');
  await expect(page.getByTestId('today-badge')).toHaveText('Today +5');

  await page.keyboard.insertText('\n\n' + Array.from({ length: 700 }, () => 'pasted').join(' '));
  await page.waitForTimeout(600);
  await expect(page.getByTestId('today-badge')).toHaveText('Today +5');
});
