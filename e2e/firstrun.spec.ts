import { expect, test } from '@playwright/test';
import path from 'node:path';

// First run: an empty vault offers three ways to begin, and opening an export is one of them.
test('an empty vault can begin by opening an export file', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-new-story')).toBeVisible();
  await expect(page.getByTestId('home-load-demo')).toBeVisible();
  await page.getByTestId('home-import-file').setInputFiles(path.resolve('src', 'core', 'fixtures', 'format-v3.json'));
  await expect(page.getByText(/Imported \d+ entities and \d+ scenes\./)).toBeVisible();
  await expect(page.getByTestId('tl-scene').first()).toBeVisible();
});
