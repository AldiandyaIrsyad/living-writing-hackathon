import { expect, test, type Page } from '@playwright/test';
import { expectOpenScene, loadDemo } from './helpers';

// Ctrl+K palette: go-to queries (:5, :5.2, :a2, :s12) and chapters/arcs in normal search.

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('switcher-input')).toBeVisible();
}

async function runQuery(page: Page, query: string): Promise<void> {
  await openPalette(page);
  await page.getByTestId('switcher-input').fill(query);
  await page.keyboard.press('Enter');
}

test.describe('palette go-to', () => {
  test(':3 opens the first scene of chapter 3', async ({ page }) => {
    await loadDemo(page);
    await runQuery(page, ':3');
    await expect(page.getByTestId('switcher-input')).toHaveCount(0);
    await expectOpenScene(page, 'The Betrayal');
  });

  test(':a2 opens the first scene of arc II', async ({ page }) => {
    await loadDemo(page);
    await runQuery(page, ':a2');
    await expectOpenScene(page, 'Gathering Storm');
  });

  test('>5 works like :5', async ({ page }) => {
    await loadDemo(page);
    await runQuery(page, '>5');
    await expectOpenScene(page, 'The Fall of Ashford');
  });

  test(':9 says the chapter does not exist and keeps the palette open', async ({ page }) => {
    await loadDemo(page);
    await openPalette(page);
    await page.getByTestId('switcher-input').fill(':9');
    await expect(page.getByTestId('switcher-empty')).toContainText("Chapter 9 doesn't exist. The story has 5 chapters.");
    await expect(page.getByTestId('switcher-result')).toHaveCount(0);
    await expect(page.getByTestId('switcher-input')).toBeVisible();
  });

  test('an empty query shows the go-to tip', async ({ page }) => {
    await loadDemo(page);
    await openPalette(page);
    await expect(page.getByTestId('switcher-tip')).toContainText(':a2 for an arc');
    await page.getByTestId('switcher-input').fill(':');
    await expect(page.getByTestId('switcher-tip')).toContainText(':s12');
  });
});

test.describe('palette search', () => {
  test('a chapter title lists the chapter and Enter opens it', async ({ page }) => {
    await loadDemo(page);
    await openPalette(page);
    await page.getByTestId('switcher-input').fill('Chapter 3');
    const chapter = page.locator('[data-testid="switcher-result"][data-kind="chapter"]');
    await chapter.filter({ hasText: 'Chapter 3' }).click();
    await expectOpenScene(page, 'The Betrayal');
  });

  test('arcs are listed by title', async ({ page }) => {
    await loadDemo(page);
    await openPalette(page);
    await page.getByTestId('switcher-input').fill('Ash');
    await expect(page.locator('[data-testid="switcher-result"][data-kind="arc"]').filter({ hasText: 'Arc II: Ash' })).toBeVisible();
  });
});
