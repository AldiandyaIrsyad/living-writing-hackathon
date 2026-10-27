import { expect, test, type Page } from '@playwright/test';
import { clip, dragToZone, hoverLink, loadDemo, openEntity, openScene, selectType, showWorld, typeListed, waitSaved, useStateSlider } from './helpers';

// Every test loads the demo itself (fresh browser context => empty IndexedDB).
// Acceptance criteria: SPEC.md section 6.3 (demo seed: section 5).

/** Scrub an entity page to "just after <scene>" (picked by scene title, so ids don't matter). */
async function scrubAfter(page: Page, sceneTitle: string): Promise<void> {
  const select = page.getByTestId('time-select');
  const value = await select.locator('option').filter({ hasText: `After “${sceneTitle}”` }).first().getAttribute('value');
  if (!value) throw new Error(`no time option for “${sceneTitle}”`);
  await select.selectOption(value);
}

async function clipColumns(page: Page): Promise<string[]> {
  return page.getByTestId('tl-scene').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-scene')}@${e.getAttribute('data-column')}`).sort());
}

/** Create a new entity type from the Vault menu's "Entity types" page. */
async function createType(page: Page, name: string): Promise<void> {
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('nav-types').click();
  await page.getByTestId('new-type-name').fill(name);
  await page.getByTestId('create-type').click();
  await expect.poll(() => typeListed(page, name)).toBe(true);
}

/** Create an entity of a type via the World list's "+" and rename it. */
async function createEntity(page: Page, type: string, name: string): Promise<void> {
  await selectType(page, type);
  await page.getByTestId('new-entity').click();
  const nameField = page.getByTestId('entity-name');
  await expect(nameField).toHaveValue(`New ${type}`);
  await nameField.fill(name);
  await nameField.press('Enter');
  await expect(nameField).toHaveValue(name);
}

/**
 * Insert a scene right after "Supper at the Inn" using the clip's "+" (insert here). It joins Supper's chapter, so it
 * opens in Chapter 1's document, as its last scene.
 */
async function insertSceneAfterSupper(page: Page): Promise<void> {
  const supper = clip(page, 'Supper at the Inn');
  await supper.hover();
  await supper.getByTestId('tl-insert-after').click();
  await expect(page.getByTestId('chapter-title')).toHaveValue('Chapter 1');
  await expect(page.getByTestId('scene-editor').locator('.cm-content')).toContainText('Untitled scene');
  await expect(clip(page, 'Untitled scene')).toBeVisible();
}

// These pages use the State slider (the setting), not the timeline playhead.
test.beforeEach(({ page }) => useStateSlider(page));

test.describe('entity state in the story (SPEC 6.3)', () => {
  test('hovering [[norman]] in chapter 1 shows status: alive', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await hoverLink(page, 'norman');
    await expect(page.getByTestId('hovercard')).toContainText('status: alive');
  });

  test('Norman on his entity page at latest shows status: dead', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    await expect(page.getByTestId('entity-time-label')).toHaveText('Latest');
    await expect(page.getByTestId('entity-state')).toContainText('status: dead');
  });

  test('scrubbing Norman to chapter 4 shows status: alive', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    await scrubAfter(page, 'Gathering Storm');
    await expect(page.getByTestId('entity-time-label')).toContainText('Gathering Storm');
    await expect(page.getByTestId('entity-state')).toContainText('status: alive');
  });

  test('alice-bob is friends in chapter 2 and enemies in chapter 4', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Alice-Bob');
    await scrubAfter(page, 'The Stranger');
    await expect(page.getByTestId('entity-state')).toContainText('status: friends');
    await scrubAfter(page, 'Gathering Storm');
    await expect(page.getByTestId('entity-state')).toContainText('status: enemies');
  });

  test("dragging Mira's Road after chapter 5 empties sword-of-ash.owner at chapter 4", async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Sword of Ash');
    await scrubAfter(page, 'Gathering Storm');
    // Before the move Mira's Road happens before chapter 4, so the owner is Mira.
    await expect(page.getByTestId('entity-state')).toContainText('owner: [[Mira]]');

    await page.getByTestId('mode-move').click();
    const storyHeader = page.locator('[data-testid="tl-story"][data-story="Mira\'s Road"]');
    await dragToZone(storyHeader, clip(page, 'The Fall of Ashford'), 'after');
    // The move changes what other scenes see; the app says so.
    await expect(page.getByTestId('toast-info')).toContainText('something different');
    await waitSaved(page);

    await openEntity(page, 'Sword of Ash');
    await scrubAfter(page, 'Gathering Storm');
    await expect(page.getByTestId('entity-time-label')).toContainText('Gathering Storm');
    await expect(page.getByTestId('entity-state').locator('[data-prop="owner"]')).toHaveCount(0);

    // ...and the owner is Mira once the story is read to the end.
    await page.getByTestId('time-select').selectOption('latest');
    await expect(page.getByTestId('entity-state')).toContainText('owner: [[Mira]]');
  });

  test('dropping Crossroads "at the same time as" Gathering Storm puts both in one column', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('mode-move').click();
    await expect(clip(page, 'Crossroads')).toHaveAttribute('data-column', '2');
    await dragToZone(clip(page, 'Crossroads'), clip(page, 'Gathering Storm'), 'same');
    await waitSaved(page);
    await expect
      .poll(async () => {
        const a = await clip(page, 'Crossroads').getAttribute('data-column');
        const b = await clip(page, 'Gathering Storm').getAttribute('data-column');
        return a !== null && a === b;
      })
      .toBe(true);
  });

  test('a drag that would create a time loop is rejected with a message and changes nothing', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('mode-constrain').click();
    const before = await clipColumns(page);
    const undoDisabled = await page.getByTestId('undo').isDisabled();

    // Supper must come before the Fall; dropping it after the Fall closes a loop.
    await dragToZone(clip(page, 'Supper at the Inn'), clip(page, 'The Fall of Ashford'), 'after');

    await expect(page.getByTestId('toast-error')).toContainText('time loop');
    expect(await clipColumns(page)).toEqual(before);
    expect(await page.getByTestId('undo').isDisabled()).toBe(undoDisabled);
  });

  test('the range bar zooms by dragging its end and fits on double-click', async ({ page }) => {
    await loadDemo(page);
    const supper = clip(page, 'Supper at the Inn');
    const before = (await supper.boundingBox())!.width;

    // Drag the window's right handle halfway left: the visible range halves, clips get wider.
    const end = page.getByTestId('tl-range-end');
    const win = (await page.getByTestId('tl-range-window').boundingBox())!;
    const box = (await end.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(win.x + win.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await supper.boundingBox())?.width ?? 0).toBeGreaterThan(before * 1.4);

    // Chapter and arc bands stay above the clips at any zoom.
    await expect(page.locator('[data-testid="tl-chapter"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="tl-arc"][data-title="Arc I: Embers"]')).toBeVisible();

    // Double-click the bar to fit the whole work again.
    await page.getByTestId('tl-rangebar').dblclick();
    await expect(clip(page, 'The Fall of Ashford')).toBeVisible();
    await expect(supper).toBeVisible();
  });
});

test.describe('authoring', () => {
  test('creating an entity type shows it in the World list', async ({ page }) => {
    await loadDemo(page);
    await createType(page, 'Spell');
    await expect.poll(() => typeListed(page, 'Spell')).toBe(true);
  });

  test('an entity with freeform properties keeps them', async ({ page }) => {
    await loadDemo(page);
    await createType(page, 'Spell');
    await createEntity(page, 'Spell', 'Gandalf');

    const base = page.getByTestId('base-props');
    await base.getByLabel('New property name').fill('power');
    await base.getByRole('button', { name: 'Add property' }).click();
    await base.getByLabel('Value', { exact: true }).fill('fire');
    await base.getByLabel('Value', { exact: true }).press('Enter');

    await expect(page.getByTestId('entity-state')).toContainText('power: fire');
    await showWorld(page);
    await expect(page.locator('[data-testid="side-entity"][data-name="Gandalf"]')).toBeVisible();
  });

  test('"insert here" creates a new scene after a clip', async ({ page }) => {
    await loadDemo(page);
    await insertSceneAfterSupper(page);
  });

  test('[[ autocomplete finds a newly created entity', async ({ page }) => {
    await loadDemo(page);
    await createType(page, 'Spell');
    await createEntity(page, 'Spell', 'Gandalf');
    await insertSceneAfterSupper(page);

    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('[[Gan');
    // Pick the option with the mouse: Enter sent right as the popup opens is sometimes not applied.
    await page.locator('.cm-tooltip-autocomplete li').filter({ hasText: 'Gandalf' }).click();
    await expect(page.getByTestId('scene-editor').locator('.cm-content')).toContainText('[[Gandalf]]');
  });
});

test.describe('persistence and exchange (SPEC 6.3)', () => {
  test('reloading the page keeps everything', async ({ page }) => {
    await loadDemo(page);
    await insertSceneAfterSupper(page);
    await waitSaved(page);

    await page.reload();

    await expect(clip(page, 'The Fall of Ashford')).toBeVisible();
    await expect(clip(page, 'Untitled scene')).toBeVisible();
    await expect(page.locator('[data-testid="tl-story"][data-story="Mira\'s Road"]')).toBeVisible();
    await showWorld(page);
    await expect(page.locator('[data-testid="side-entity"][data-name="Norman"]')).toBeVisible();
  });

  for (const format of ['zip', 'json'] as const) test(`export ${format}, delete everything, import ${format}: the demo assertions still pass`, async ({ page }, testInfo) => {
    await loadDemo(page);
    await openEntity(page, 'Ashford');
    await page.getByTestId('rel-add-child').selectOption({ label: 'Mira · Character' });

    await page.getByTestId('vault-menu').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`export-${format}`).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`[.]${format}$`));
    const zipPath = testInfo.outputPath(`living-writing-export.${format}`);
    await download.saveAs(zipPath);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('vault-menu').click();
    await page.getByTestId('clear-vault').click();
    await expect(page.getByTestId('tl-track')).toHaveCount(0);
    await expect(clip(page, 'Supper at the Inn')).toHaveCount(0);

    await page.getByTestId('import-file').setInputFiles(zipPath);
    await expect(clip(page, 'The Fall of Ashford')).toBeVisible();
    await expect(page.locator('[data-testid="tl-story"][data-story="Mira\'s Road"]')).toBeVisible();

    await openScene(page, 'Supper at the Inn');
    await hoverLink(page, 'norman');
    await expect(page.getByTestId('hovercard')).toContainText('status: alive');

    await openEntity(page, 'Norman');
    await expect(page.getByTestId('entity-state')).toContainText('status: dead');

    await openEntity(page, 'Alice-Bob');
    await scrubAfter(page, 'The Stranger');
    await expect(page.getByTestId('entity-state')).toContainText('status: friends');
    await scrubAfter(page, 'Gathering Storm');
    await expect(page.getByTestId('entity-state')).toContainText('status: enemies');

    await openEntity(page, 'Mira');
    await expect(page.getByTestId('relations-panel').locator('[data-kind="parent"]')).toHaveText('Ashford');
  });
});
