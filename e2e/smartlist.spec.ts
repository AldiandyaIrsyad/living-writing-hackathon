import { expect, test, type Page } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

async function ask(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
}

test('a where query lists matches in the palette, can be kept as a smart list whose page lists the matches', async ({ page }) => {
  await loadDemo(page);
  await openScene(page, 'Supper at the Inn');

  // Typed straight into the palette: Norman dies in the last scene, so at the latest point he is the only one dead.
  await ask(page, 'where status=dead at latest');
  await expect(page.locator('.switcher').getByRole('option', { name: /Norman/ })).toBeVisible();

  page.once('dialog', (d) => void d.accept('The dead'));
  await page.locator('.switcher').getByRole('option', { name: /Keep this query as a smart list/ }).click();
  await expect(page.getByTestId('query-results')).toBeVisible();
  await expect(page.getByTestId('query-match')).toHaveText(['Norman']);

  // A query without a time clause answers at the playhead: nobody is dead at the start of the story.
  await ask(page, 'where status=dead');
  await expect(page.locator('.switcher').getByRole('option', { name: /Norman/ })).toHaveCount(0);
  await expect(page.locator('.switcher').getByText('Where status=dead · 0')).toBeVisible();
});

test('a where query that cannot be read says why', async ({ page }) => {
  await loadDemo(page);
  await ask(page, 'where status=dead banana');
  await expect(page.getByText(/Did not understand/)).toBeVisible();
});
