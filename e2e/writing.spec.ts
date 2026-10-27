import { expect, test } from '@playwright/test';
import { loadDemo, openEntity, openScene, typeListed, openCastCard, useStateSlider } from './helpers';

// Writing features from SPEC §3b: affiliations, type gallery, author notes, manuscript export.

// These pages use the State slider (the setting), not the timeline playhead.
test.beforeEach(({ page }) => useStateSlider(page));

test.describe('affiliations', () => {
  test('memberships change over time and groups list their members', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Mira');
    const chips = page.getByTestId('affiliations-panel').getByTestId('affiliation-chip');

    // At the start Mira belongs to no group; after Crossroads she has joined the Wanderers' Guild.
    await page.getByTestId('time-select').selectOption('start');
    await expect(chips.filter({ hasText: "The Wanderers' Guild" })).toHaveCount(0);
    await page.getByTestId('time-select').selectOption('latest');
    await expect(chips.filter({ hasText: "The Wanderers' Guild" })).toBeVisible();

    await openEntity(page, 'The Ashford Guard');
    const members = page.getByTestId('group-member');
    await expect(members.filter({ hasText: 'Norman' })).toBeVisible();
    await expect(members.filter({ hasText: 'Bob' })).toBeVisible();
  });

  test('joining a group from the entity page', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Bob');
    await page.getByTestId('join-group').selectOption({ label: "The Wanderers' Guild" });
    await page.getByTestId('join-when').selectOption({ index: 0 });
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('affiliations-panel').getByTestId('affiliation-chip').filter({ hasText: "The Wanderers' Guild" })).toBeVisible();
  });

  test('cast cards show affiliations', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Fall of Ashford');
    const norman = await openCastCard(page, 'Norman');
    await expect(norman.getByTestId('affiliation-chip').filter({ hasText: 'The Ashford Guard' })).toBeVisible();
  });
});

test.describe('type gallery', () => {
  test('adds Creature only when asked', async ({ page }) => {
    await loadDemo(page);
    expect(await typeListed(page, 'Creature')).toBe(false);
    await page.getByTestId('vault-menu').click();
    await page.getByTestId('nav-types').click();
    const card = page.locator('[data-testid="preset-card"][data-preset="creature"]');
    await card.getByTestId('preset-add').click();
    await expect(card.getByTestId('preset-add')).toBeDisabled();
    await expect.poll(() => typeListed(page, 'Creature')).toBe(true);
  });
});

test.describe('author notes', () => {
  test('notes are highlighted, hidden in preview, and listed', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    const editor = page.getByTestId('scene-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' %% TODO: foreshadow the fire %%');
    await expect(page.locator('.cm-author-note').filter({ hasText: 'foreshadow the fire' })).toBeVisible();

    await page.getByTestId('toggle-preview').click();
    await expect(page.getByTestId('scene-preview')).not.toContainText('foreshadow the fire');

    await page.getByTestId('vault-menu').click();
    await page.getByTestId('nav-notes').click();
    await expect(page.getByTestId('notes-row').filter({ hasText: 'foreshadow the fire' })).toBeVisible();
  });

  test('Ctrl+/ inserts a note', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    const editor = page.getByTestId('scene-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Control+/');
    await page.keyboard.type('check the timeline');
    await expect(page.locator('.cm-author-note').filter({ hasText: 'check the timeline' })).toBeVisible();
  });
});

test.describe('manuscript export', () => {
  test('exports a chapter range as Markdown without author notes', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('vault-menu').click();
    await page.getByTestId('export-manuscript').click();
    await page.getByTestId('export-story').selectOption({ label: 'The Ashford Chronicle' });
    await page.getByTestId('export-from').selectOption({ index: 1 });
    await page.getByTestId('export-to').selectOption({ index: 2 });
    await page.getByTestId('export-format-md').check();
    const preview = page.getByTestId('export-preview');
    await expect(preview).toContainText('Chapter 2');
    await expect(preview).toContainText('Chapter 3');
    await expect(preview).not.toContainText('Chapter 1');
    await expect(preview).not.toContainText('[[');

    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    expect((await download).suggestedFilename()).toMatch(/\.md$/);
  });
});
