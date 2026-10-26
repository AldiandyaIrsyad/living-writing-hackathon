import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

async function openProblems(page: import('@playwright/test').Page) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>show problems');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('problems-dialog')).toBeVisible();
}

test.describe('problems list', () => {
  test('the demo is quiet; a link to nothing shows up and stays dismissed', async ({ page }) => {
    await loadDemo(page);
    await openProblems(page);
    await expect(page.getByTestId('problems-dialog')).toContainText('No problems found');
    await page.keyboard.press('Escape');

    await openScene(page, 'Supper at the Inn');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' She asked after [[Nobody Atall]].');
    await page.keyboard.press('Control+j');

    await expect(page.getByTestId('problems-badge')).toHaveText('Problems (1)'); // worked out a moment after typing stops
    await openProblems(page);
    const row = page.getByTestId('problem-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Nobody Atall');
    await row.getByTestId('problem-dismiss').click();
    await expect(page.getByTestId('problems-dialog')).toContainText('No problems found');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('problems-badge')).toHaveCount(0);
    await openProblems(page);
    await expect(page.getByTestId('problem-row')).toHaveCount(0);
    await page.getByRole('button', { name: /Show 1 dismissed/ }).click();
    await expect(page.getByTestId('problem-row')).toHaveCount(1);
  });
});
