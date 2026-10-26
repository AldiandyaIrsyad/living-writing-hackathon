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

// A bug that happened: the story page's first scene had no chapter, so the next scene opened a "Chapter 1" of its own.
test('a new story’s first scene opens Chapter 1, and the next scene joins it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-new-story').click();
  await page.getByTestId('new-scene').click();
  await expect(page.getByTestId('chapter-title')).toHaveValue('Chapter 1');
  const first = page.getByTestId('tl-scene').first();
  await first.hover();
  await first.getByTestId('tl-insert-after').click();
  await expect(page.getByTestId('tl-scene')).toHaveCount(2);
  await expect(page.getByTestId('chapter-title')).toHaveValue('Chapter 1');
  // The chapter's document holds both scenes.
  await expect(page.getByTestId('scene-editor').locator('.cm-content')).toHaveText(/Untitled scene[\s\S]*Untitled scene/);
});
