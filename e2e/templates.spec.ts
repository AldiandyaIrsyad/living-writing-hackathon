import { expect, test, type Page } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

async function runCommand(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>' + text);
  await page.keyboard.press('Enter');
}

test('a scene saved as a template can be inserted into another scene with its placeholders filled in', async ({ page }) => {
  await loadDemo(page);
  await openScene(page, 'The Stranger');
  const editor = page.getByTestId('scene-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nTemplate for {{title}} in {{Chapter}}, not {{nonsense}}.');

  page.once('dialog', (d) => void d.accept('Skeleton'));
  await runCommand(page, 'save this scene as a template');
  await expect(page.getByText('Saved as the template').first()).toBeVisible();

  await openScene(page, 'The Betrayal');
  await editor.click();
  await page.keyboard.press('Control+End');
  await runCommand(page, 'insert template: skeleton');
  await expect(editor).toContainText('Template for The Betrayal in Chapter 3, not {{nonsense}}.');
});
