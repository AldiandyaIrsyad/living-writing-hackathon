import { expect, test, type Page } from '@playwright/test';
import { clip, loadDemo, openCastCard, openEntity, openScene } from './helpers';

// Deleting a commit that later scenes depend on asks first, and says what each of them would see.
test.describe('retcon preview', () => {
  const statusCommit = (page: Page) => page.locator('[data-testid="change-row"]').filter({ has: page.locator('[data-testid="change-prop"][value="status"]') });

  /** Opens The Fall of Ashford's commits and presses × on Norman's death (the one that sets "status"). */
  async function deleteNormansDeath(page: Page) {
    await openScene(page, 'The Fall of Ashford');
    await page.getByTestId('insp-chip-commits').click();
    await expect(statusCommit(page).first()).toBeVisible();
    await statusCommit(page).first().getByRole('button', { name: 'Delete change' }).click();
  }

  test('lists the later scene that mentions Norman, and Cancel keeps the death', async ({ page }) => {
    await loadDemo(page);
    // A new scene after the fall that mentions him.
    const fall = clip(page, 'The Fall of Ashford');
    await fall.hover();
    await fall.getByTestId('tl-insert-after').click();
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.type('[[Norman]] is still here.');
    await expect(page.locator('[data-testid="cast-card"][data-entity="Norman"]')).toBeVisible();
    await page.keyboard.press('Control+j'); // typing hid the timeline

    await deleteNormansDeath(page);
    const dialog = page.getByTestId('impact-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('impact-row').first()).toContainText('status: dead → alive');

    await page.getByTestId('impact-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(statusCommit(page).first()).toBeVisible(); // still there
  });

  test('deletes straight away when no later scene is affected', async ({ page }) => {
    await loadDemo(page);
    await deleteNormansDeath(page);
    await expect(page.getByTestId('impact-dialog')).toHaveCount(0);
    await expect(statusCommit(page)).toHaveCount(0);
  });
});

test.describe('retcon preview: starting properties', () => {
  test('changing a starting property lists the scenes that mention him; Cancel puts the old value back in the field', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    const value = page.getByTestId('base-props').getByLabel('Value', { exact: true }).first();
    await expect(value).toHaveValue('alive');
    await value.fill('away');
    await value.press('Enter');

    const dialog = page.getByTestId('impact-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('impact-row').first()).toContainText('status: alive → away');

    await page.getByTestId('impact-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(value).toHaveValue('alive');
  });

  test('Go ahead applies it', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    const value = page.getByTestId('base-props').getByLabel('Value', { exact: true }).first();
    await value.fill('away');
    await value.press('Enter');
    await page.getByTestId('impact-apply').click();
    await expect(page.getByTestId('impact-dialog')).toHaveCount(0);
    await expect(value).toHaveValue('away');
  });
});

test.describe('retcon preview: recording a change from the Cast', () => {
  test('a death recorded early lists the later scenes that mention him, and Go ahead records it', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    const norman = await openCastCard(page, 'Norman');
    await norman.getByTestId('commit-open').click();
    await norman.getByTestId('commit-message').fill('Collapses at the table');
    await norman.getByLabel('Property (optional)').fill('status');
    await norman.getByLabel('Value', { exact: true }).fill('dead');
    await norman.getByTestId('commit-submit').click();

    const dialog = page.getByTestId('impact-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('impact-row').filter({ hasText: 'status: alive → dead' }).first()).toBeVisible();

    await page.getByTestId('impact-apply').click();
    await expect(dialog).toHaveCount(0);
    await expect(norman.getByTestId('cast-here').filter({ hasText: 'Collapses at the table' })).toBeVisible();
  });
});

test.describe('review list', () => {
  test('"Go ahead and add to review list" lists the touched scenes; they stay until the writer marks them done', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    const value = page.getByTestId('base-props').getByLabel('Value', { exact: true }).first();
    await value.fill('away');
    await value.press('Enter');
    const touched = await page.getByTestId('impact-row').count();
    await page.getByTestId('impact-apply-review').click();

    const badge = page.getByTestId('review-badge');
    await expect(badge).toHaveText(`Review (${touched})`);
    await badge.click();
    const rows = page.getByTestId('review-row');
    await expect(rows).toHaveCount(touched);
    await expect(rows.first()).toContainText('status: alive → away');

    // The outline marks the chapters that hold flagged scenes.
    await page.keyboard.press('Escape');
    await page.getByTestId('act-stories').click();
    await expect(page.getByTestId('outline-review').first()).toBeVisible();
    await badge.click();
    await rows.first().getByTestId('review-done').click();
    await expect(page.getByTestId('review-badge')).toHaveText(`Review (${touched - 1})`);
  });
});
