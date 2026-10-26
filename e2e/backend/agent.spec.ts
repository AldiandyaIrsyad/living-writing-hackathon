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

  // A contributor model is called out before anything is sent; the model picked is the one that reads.
  await page.getByTestId('agent-model').selectOption('muse-spark-1.3-contributor');
  await expect(page.getByTestId('agent-contributor-warning')).toBeVisible();
  await page.getByTestId('agent-model').selectOption('muse-spark-1.2');
  await expect(page.getByTestId('agent-contributor-warning')).toHaveCount(0);

  await page.getByTestId('agent-read').click();
  const report = page.getByTestId('agent-report');
  await expect(report).toContainText('New page: Nora');
  await expect(report).toContainText('read by muse-spark-1.2');
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

test('"After I stop typing" reads the scene once the wait the writer picked has passed', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-switch').click();
  await page.getByTestId('login-email').fill(`idle-${Date.now()}@example.com`);
  await page.getByTestId('login-password').fill('correct horse');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('load-demo').click();
  await openScene(page, 'The Stranger');
  await page.getByLabel('When the agent reads').selectOption('idle');
  await page.getByTestId('agent-idle').selectOption('5');

  const editor = page.getByTestId('scene-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' A bell rang.');
  // The default wait is 20 s; this one is 5.
  await expect(page.getByTestId('agent-report')).toBeVisible({ timeout: 12_000 });
  // Only the scene the writer typed in is read: loading the demo is not writing every scene in it.
  await expect(page.getByTestId('agent-stop')).toHaveCount(0);
  await page.keyboard.press('Escape'); // the timeline hides while the writer types
  await openScene(page, 'Supper at the Inn');
  await expect(page.getByTestId('agent-report')).toHaveCount(0);

  // Switching to "Only when I ask" during the wait cancels the reading it would have started.
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' The fire smoked.');
  await page.waitForTimeout(2_000); // the editor has handed the text in and the wait has begun
  await page.getByLabel('When the agent reads').selectOption('off');
  await page.waitForTimeout(7_000);
  await expect(page.getByTestId('agent-report')).toHaveCount(0);
});

test('taking back what the agent linked is not read again as the writer’s edit', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-switch').click();
  await page.getByTestId('login-email').fill(`takeback-${Date.now()}@example.com`);
  await page.getByTestId('login-password').fill('correct horse');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('load-demo').click();
  await openScene(page, 'The Stranger');
  await page.getByTestId('agent-link-names').selectOption('link');
  await page.getByLabel('When the agent reads').selectOption('idle');
  await page.getByTestId('agent-idle').selectOption('5');

  const editor = page.getByTestId('scene-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Bram held the door.');
  await expect(editor.locator('.cm-wikilink[data-link-target="Bram"]')).toBeVisible({ timeout: 12_000 });
  await page.getByRole('button', { name: /Take back \d+ changes?/ }).click();
  await expect(editor.locator('.cm-wikilink[data-link-target="Bram"]')).toHaveCount(0);
  await page.waitForTimeout(7_000);
  await expect(editor.locator('.cm-wikilink[data-link-target="Bram"]')).toHaveCount(0);
  await expect(page.getByTestId('agent-report')).toHaveCount(0);

  // Undoing a reading is the same "no".
  await page.getByTestId('agent-read').click();
  await expect(editor.locator('.cm-wikilink[data-link-target="Bram"]')).toBeVisible();
  await page.getByRole('button', { name: '↶' }).click();
  await expect(editor.locator('.cm-wikilink[data-link-target="Bram"]')).toHaveCount(0);
  await page.waitForTimeout(7_000);
  await expect(editor.locator('.cm-wikilink[data-link-target="Bram"]')).toHaveCount(0);
});

test('logging out forgets the agent’s reports, which quote the manuscript, from this browser', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-switch').click();
  await page.getByTestId('login-email').fill(`forget-${Date.now()}@example.com`);
  await page.getByTestId('login-password').fill('correct horse');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('load-demo').click();
  await openScene(page, 'The Stranger');
  await page.getByTestId('agent-read').click();
  await expect(page.getByTestId('agent-report')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lw-agent-reports-v2'))).toContain('Norman');

  await waitSaved(page);
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('log-out').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lw-agent-reports-v2'))).toBeNull();
});
