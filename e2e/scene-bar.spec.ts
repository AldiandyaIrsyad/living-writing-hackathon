import { expect, test } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

// What a scene says about itself is above the text; the quick panel keeps the notes you left and the cast.

test.describe('scene bar and quick panel', () => {
  test('When and Changes open above the text, and Changes lists what the scene changes', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Fall of Ashford');
    const bar = page.getByTestId('scene-bar');
    await expect(bar).toContainText('Changes (');
    await bar.getByTestId('scene-chip-when').click();
    await expect(page.getByTestId('placement-panel')).toBeVisible();
    await bar.getByTestId('scene-chip-changes').click();
    await expect(page.getByTestId('placement-panel')).toHaveCount(0);
    await expect(page.getByTestId('changes-panel')).toBeVisible();
    await expect(page.getByTestId('changes-panel').getByTestId('change-row').first()).toBeVisible();
  });

  test('the quick panel lists the notes of the open chapter, narrows to the scene, and widens to everything', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    const editor = page.getByTestId('scene-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n%% ask Mira about the ring %%');
    const notes = page.getByTestId('insp-notes');
    await expect(notes.getByTestId('insp-note')).toContainText('ask Mira about the ring');

    await page.getByTestId('notes-scope').selectOption('all');
    await expect(notes.getByTestId('insp-note')).toContainText('ask Mira about the ring');
    await page.keyboard.press('Control+j'); // typing hid the timeline
    await openScene(page, 'Supper at the Inn');
    await expect(notes.getByTestId('insp-note').filter({ hasText: 'ask Mira' })).toHaveCount(1);
    await page.getByTestId('notes-scope').selectOption('chapter');
    await expect(notes.getByTestId('insp-note')).toHaveCount(0);
  });

  test('a long cast gets a find box', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await expect(page.getByTestId('cast-find')).toHaveCount(0);

    const editor = page.getByTestId('scene-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    const names = ['Alice', 'Bob', 'Mira', 'Ashford', 'Alice-Bob', 'The Ashford Guard', "The Wanderers' Guild"];
    for (const n of names) await page.keyboard.type(` [[${n}]]`);
    await expect(page.getByTestId('cast-find')).toBeVisible();
    await page.getByTestId('cast-find').fill('guild');
    await expect(page.getByTestId('cast-card')).toHaveCount(1);
  });
});
