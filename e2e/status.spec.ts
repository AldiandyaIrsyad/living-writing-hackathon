import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

test.describe('scene status', () => {
  test('a status shows as a dot on the clip and the outline, rolls up on the chapter, and filters the export', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await page.getByTestId('scene-status').selectOption('done');

    await expect(page.getByTestId('clip-status')).toHaveCount(1);
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.locator('[data-testid="outline-status"][data-status="done"]')).toHaveCount(1);
    await expect(page.getByTestId('outline-rollup').first()).toHaveText('✓ 1/1');

    await page.getByTestId('vault-menu').click();
    await page.getByTestId('export-manuscript').click();
    await page.getByTestId('export-story').selectOption({ label: 'The Ashford Chronicle' });
    await page.getByTestId('export-format-md').check();
    const preview = page.getByTestId('export-preview');
    await expect(preview).toContainText('Across the table');
    await expect(preview).toContainText('Ashford'); // the other scenes are there
    await page.getByTestId('export-only-done').check();
    await expect(preview).toContainText('Across the table'); // Supper's text
    await expect(preview).not.toContainText('The Fall of Ashford');
  });
});
