import { expect, test } from '@playwright/test';
import { clip, expectOpenScene, loadDemo, openEntity, openScene, typeListed } from './helpers';

// Writing-flow features: spans, quick // notes, notes toggle, create from [[, hover preview,
// highlight picker, world type dropdown.

test.describe('spans', () => {
  test('stretching a clip and dropping a side story during its later end', async ({ page }) => {
    await loadDemo(page);
    const fall = clip(page, 'The Fall of Ashford');
    const before = (await fall.boundingBox())!;

    // Stretch The Fall of Ashford to 3 columns by dragging its right edge.
    await fall.hover();
    const handle = fall.getByTestId('tl-clip-resize');
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + before.width * 2 + h.width / 2, h.y + h.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(fall).toHaveAttribute('data-span', '3');

    // Drop Mira's Road (whole story) into the last third of the stretched clip.
    const box = (await fall.boundingBox())!;
    await page.getByTestId('tl-story').filter({ hasText: "Mira's Road" }).dragTo(fall, {
      targetPosition: { x: box.width * 0.75, y: box.height / 2 },
    });
    const fallCol = Number(await fall.getAttribute('data-column'));
    const crossCol = Number(await clip(page, 'Crossroads').getAttribute('data-column'));
    expect(crossCol).toBeGreaterThan(fallCol);
    expect(crossCol).toBeLessThan(fallCol + 3);

    // During the Fall, Norman has not died yet (the Fall's changes apply when it ends).
    await openScene(page, 'Crossroads');
    await expect(page.locator('[data-testid="insp-scene"]')).toContainText('Crossroads');
  });
});

test.describe('quick notes', () => {
  test('// comments are notes: highlighted, hidden in preview, collapsible in the editor', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('// Norman should cough here');
    await expect(page.locator('.cm-author-note').filter({ hasText: 'Norman should cough here' })).toBeVisible();

    await page.getByTestId('toggle-notes').click();
    await expect(page.getByTestId('note-marker').first()).toBeVisible();
    await expect(page.locator('.cm-author-note').filter({ hasText: 'Norman should cough here' })).toHaveCount(0);

    await page.getByTestId('toggle-preview').click();
    await expect(page.getByTestId('scene-preview')).not.toContainText('cough');
  });

  test('a URL is not a comment', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' See https://example.com for maps.');
    await expect(page.locator('.cm-author-note').filter({ hasText: 'example.com' })).toHaveCount(0);
  });
});

test.describe('creating while writing', () => {
  test('[[ autocomplete can create a new character without leaving the scene', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' [[Tobias');
    await page.locator('.cm-tooltip-autocomplete li').filter({ hasText: /Create .*Tobias.* as Character/ }).click();
    await expect(page.getByTestId('scene-editor').locator('.cm-content')).toContainText('[[Tobias]]');
    await expectOpenScene(page, 'The Stranger');
    await openEntity(page, 'Tobias');
  });
});

test.describe('timeline navigation', () => {
  test('hovering the timeline previews the chapter under the cursor', async ({ page }) => {
    await loadDemo(page);
    const fall = clip(page, 'The Fall of Ashford');
    await fall.hover();
    await expect(page.getByTestId('tl-hover')).toContainText('Chapter 5');
  });

  test('highlight picker can highlight several entities', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('tl-highlight').click();
    const pop = page.getByTestId('tl-highlight-pop');
    await pop.locator('[data-testid="tl-highlight-option"][data-entity="Norman"]').click();
    await pop.locator('[data-testid="tl-highlight-option"][data-entity="Mira"]').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tl-highlight-chip')).toHaveCount(2);
  });
});

test.describe('world types', () => {
  test('a type can be added from the World panel dropdown', async ({ page }) => {
    await loadDemo(page);
    expect(await typeListed(page, 'Lore')).toBe(false);
    await page.getByTestId('type-select').click();
    await page.getByTestId('type-add').click();
    await page.locator('[data-testid="type-preset-option"][data-preset="lore"]').click();
    await expect.poll(() => typeListed(page, 'Lore')).toBe(true);
  });
});
