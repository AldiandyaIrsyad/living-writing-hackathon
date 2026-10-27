import { expect, test, type Page } from '@playwright/test';
import { focusTimeline, loadDemo, openEntity, playheadX } from './helpers';

// Characters and wiki pages on the timeline: a row with a keyframe per change, and an entity page whose State
// follows the playhead (the setting "State panel time" brings back the old slider).

const state = (page: Page) => page.getByTestId('entity-state');

test.describe('State follows the timeline', () => {
  test('stepping to a character’s next change moves the playhead and the State with it', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    // Before any scene he is alive and has nothing earlier to step back to.
    await expect(state(page)).toContainText('status: alive');
    await expect(page.getByTestId('key-prev')).toBeDisabled();

    await page.getByTestId('key-next').click();
    await expect(state(page)).toContainText('status: dead');
    expect(await playheadX(page)).toBeGreaterThan(0);
    await expect(page.getByTestId('key-next')).toBeDisabled();

    // Moving the playhead back by hand brings the earlier state back.
    await focusTimeline(page);
    await page.keyboard.press('Home');
    await expect(state(page)).toContainText('status: alive');
  });

  test('a row on the timeline has a keyframe at each change; clicking it puts the playhead there', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    await page.getByTestId('entity-on-timeline').click();
    const key = page.getByTestId('tl-cast').filter({ hasText: 'Norman' }).getByTestId('tl-key');
    await expect(key).toHaveCount(1);

    await key.click();
    expect(await playheadX(page)).toBe(Number(await key.getAttribute('data-column')));
    await expect(state(page)).toContainText('status: dead');

    await page.getByTestId('tl-cast-remove').click();
    await expect(page.getByTestId('tl-cast')).toHaveCount(0);
  });

  test('a row can be added from the + Track menu', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('tl-add-track').click();
    await page.getByTestId('tl-add-cast-option').filter({ hasText: 'Mira' }).click();
    await expect(page.getByTestId('tl-cast').filter({ hasText: 'Mira' })).toBeVisible();
  });

  test('moving the playhead leaves a page draft behind', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    await page.getByTestId('key-next').click();
    await page.getByTestId('revise-page').click();
    await expect(page.getByTestId('revision-bar')).toBeVisible();
    await focusTimeline(page);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('revision-bar')).toHaveCount(0);
  });

  test('the setting brings back the slider, and the arrows go away', async ({ page }) => {
    await loadDemo(page);
    await openEntity(page, 'Norman');
    await expect(page.getByTestId('time-slider')).toHaveCount(0);

    await page.getByTestId('tl-settings').click();
    await page.getByTestId('tl-state-time-slider').click();
    await expect(page.getByTestId('time-slider')).toBeVisible();
    await expect(page.getByTestId('key-next')).toHaveCount(0);

    // It is remembered across a reload.
    await page.reload();
    await openEntity(page, 'Norman');
    await expect(page.getByTestId('time-slider')).toBeVisible();
  });
});

test.describe('the timeline dock', () => {
  const dockHeight = (page: Page) => page.getByTestId('timeline').evaluate((el) => (el as HTMLElement).offsetHeight);

  test('the + Track list shows every page at once, and typing narrows it', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('tl-add-track').click();
    const options = page.getByTestId('tl-add-cast-option');
    expect(await options.count()).toBeGreaterThan(6);
    await expect(options.first()).toBeInViewport();
    await expect(options.last()).toBeInViewport();

    await page.getByTestId('tl-add-cast-filter').fill('sword');
    await expect(options).toHaveCount(1);
  });

  test('it grows with its rows, until the writer drags it to a height of their own', async ({ page }) => {
    await loadDemo(page);
    const alone = await dockHeight(page);
    await page.getByTestId('tl-add-track').click();
    await page.locator('[data-testid="tl-add-cast-option"][data-entity="Alice"]').click();
    await expect.poll(() => dockHeight(page)).toBeGreaterThan(alone);

    // Dragging its top edge up keeps what was dragged to, whatever is added afterwards.
    const edge = (await page.locator('.dock-resizer').boundingBox())!;
    const grown = await dockHeight(page);
    await page.mouse.move(edge.x + 40, edge.y + 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + 40, edge.y - 58, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => dockHeight(page)).toBeGreaterThan(grown + 55);
    const dragged = await dockHeight(page);
    await openEntity(page, 'Mira');
    await page.getByTestId('entity-on-timeline').click();
    await expect(page.getByTestId('tl-cast').filter({ hasText: 'Mira' })).toBeVisible();
    expect(await dockHeight(page)).toBe(dragged);

    // The setting takes it back to fitting its rows.
    await page.getByTestId('tl-settings').click();
    await page.getByTestId('tl-height-fit').click();
    await expect.poll(() => dockHeight(page)).not.toBe(dragged);
  });
});
