import { expect, test, type Page } from '@playwright/test';
import { loadDemo, openEntity } from './helpers';

// The wiki: type buttons on the activity bar, boilerplate for new entities, parent / children / siblings and the
// Ctrl+K relation queries.

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('switcher-input')).toBeVisible();
}

test.describe('wiki on the activity bar', () => {
  test('a new project starts with four types, each a button that narrows the panel to it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('act-type')).toHaveCount(4);
    await expect(page.getByTestId('act-type').first()).toHaveAttribute('data-type', 'Creature');

    // New entities start from the type's boilerplate, and the panel is on that type.
    await page.locator('[data-testid="act-type"][data-type="Person"]').click();
    await page.getByTestId('new-entity').click();
    await expect(page.getByTestId('entity-name')).toHaveValue('New Person');
    await expect(page.locator('[data-testid="note-editor"], [data-testid="note-preview"]')).toContainText('Appearance');
    await expect(page.getByTestId('side-entity').filter({ hasText: 'New Person' })).toBeVisible();

    await page.locator('[data-testid="act-type"][data-type="Place"]').click();
    await expect(page.getByTestId('side-entity')).toHaveCount(0);
  });

  test('with more than five types only the Wiki button is left, and its dropdown picks the type', async ({ page }) => {
    await loadDemo(page);
    await expect(page.getByTestId('act-type')).toHaveCount(5);
    await page.getByTestId('vault-menu').click();
    await page.getByTestId('nav-types').click();
    await page.locator('[data-testid="preset-card"][data-preset="creature"]').getByTestId('preset-add').click();
    await expect(page.getByTestId('act-type')).toHaveCount(0);
    await expect(page.getByTestId('act-wiki')).toBeVisible();
  });
});

test.describe('relations', () => {
  test('a child set on its parent shows as the parent on the child, nests in the wiki, and answers in Ctrl+K', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Ashford');
    await page.getByTestId('rel-add-child').selectOption({ label: 'Mira · Character' });
    const children = page.getByTestId('relations-panel').locator('[data-kind="child"]');
    await expect(children).toHaveText('Mira');

    // The other side needs no second link: Mira's page shows Ashford as a parent.
    await openEntity(page, 'Mira');
    await expect(page.getByTestId('relations-panel').locator('[data-kind="parent"]')).toHaveText('Ashford');

    // In the wiki Mira now hangs under Ashford. She is the open entity, so her parent is unfolded; folding it hides her.
    const mira = page.locator('[data-testid="side-entity"][data-name="Mira"]');
    await expect(mira).toBeVisible();
    await page.getByRole('button', { name: 'Collapse Ashford' }).click();
    await expect(mira).toHaveCount(0);

    await openPalette(page);
    await page.getByTestId('switcher-input').fill('children of ash');
    const row = page.getByTestId('switcher-result');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Mira');
    await page.getByTestId('switcher-input').fill('siblings of mira');
    await expect(page.getByTestId('switcher-empty')).toContainText('at the playhead');
  });

  test('an entity cannot become its own ancestor: the picker leaves it out', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Ashford');
    await page.getByTestId('rel-add-child').selectOption({ label: 'Mira · Character' });
    await openEntity(page, 'Mira');
    const options = page.getByTestId('rel-add-child').locator('option');
    await expect(options.filter({ hasText: /^Ashford ·/ })).toHaveCount(0);
  });
});
