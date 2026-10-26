import { expect, test } from '@playwright/test';
import { openScene, waitSaved } from '../helpers';

// Server mode with a stand-in model (e2e/backend/standin-model.mjs): the story agent reads a scene through the server's
// relay, writes what it learned into the vault, and everything it wrote can be taken back.

test('the agent makes a page for a new [[link]], shows a contradiction with its evidence, and takes it all back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-switch').click();
  await page.getByTestId('login-email').fill(`agent-${Date.now()}@example.com`);
  await page.getByTestId('login-password').fill('correct horse');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('load-demo').click();
  await openScene(page, 'The Stranger');

  const editor = page.getByTestId('scene-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' [[Nora]] came in out of the rain. Norman had never set foot in Ashford.');
  const nora = editor.locator('.cm-wikilink[data-link-target="Nora"]');
  await expect(nora).toHaveClass(/unresolved/);

  await page.getByTestId('agent-read').click();
  const report = page.getByTestId('agent-report');
  await expect(report).toContainText('New pages: Nora');
  await expect(nora).not.toHaveClass(/unresolved/);
  await expect(page.getByTestId('agent-contradiction')).toContainText('Norman keeps the inn at');

  // What the agent wrote is saved with the vault.
  await waitSaved(page);
  await page.reload();
  await openScene(page, 'The Stranger');
  await expect(nora).not.toHaveClass(/unresolved/);

  await page.getByRole('button', { name: /Take back \d+ changes?/ }).click();
  await expect(nora).toHaveClass(/unresolved/);
});
