import { expect, test, type Page } from '@playwright/test';
import { clip, waitSaved } from '../helpers';

// Server mode (npm run test:e2e:backend): each account has its own vault, kept on the server rather than in the browser.

async function signUp(page: Page, email: string): Promise<void> {
  await page.getByTestId('login-switch').click();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('correct horse');
  await page.getByTestId('login-submit').click();
}

test('a vault survives a reload and belongs to its account, not to the browser', async ({ page }) => {
  await page.goto('/');
  await signUp(page, `alice-${Date.now()}@example.com`);
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('load-demo').click();
  await expect(clip(page, 'Supper at the Inn')).toBeVisible();
  await waitSaved(page);

  await page.reload();
  await expect(clip(page, 'Supper at the Inn')).toBeVisible();

  await page.getByTestId('vault-menu').click();
  await page.getByTestId('log-out').click();
  await expect(page.getByTestId('login-form')).toBeVisible();

  await signUp(page, `bob-${Date.now()}@example.com`);
  await expect(page.getByTestId('home-new-story')).toBeVisible();
  await expect(clip(page, 'Supper at the Inn')).toHaveCount(0);
});
