import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Open the app in a fresh context (empty IndexedDB) and load the demo world via the Vault menu.
 */
export async function loadDemo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('vault-menu')).toBeVisible();
  await page.getByTestId('vault-menu').click();
  await page.getByTestId('load-demo').click();
  await expect(clip(page, 'Supper at the Inn')).toBeVisible();
}

/** A timeline clip for a scene, by its title. */
export function clip(page: Page, title: string): Locator {
  return page.locator(`[data-testid="tl-scene"][data-scene="${title}"]`);
}

/** Open a scene by clicking its clip (this also moves the playhead to the clip's column). */
export async function openScene(page: Page, title: string): Promise<void> {
  await clip(page, title).click();
  await expect(page.getByTestId('scene-editor')).toBeVisible();
}

/** Open an entity page from the World list in the left panel. */
export async function openEntity(page: Page, name: string): Promise<void> {
  await showWorld(page);
  // Filtering lists every match flat, so the entity is found even when it hangs folded under a parent in the tree.
  const filter = page.getByTestId('world-filter');
  await filter.fill(name);
  await page.locator(`[data-testid="side-entity"][data-name="${name}"]`).click();
  await expect(page.getByTestId('entity-name')).toHaveValue(name);
  await filter.fill('');
}

/** Wait until the vault has been written to IndexedDB after the last edit. */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
}

/** Hover a [[norman]]-style wikilink inside the open scene editor. */
export async function hoverLink(page: Page, target: string): Promise<void> {
  await page.locator(`.cm-wikilink[data-link-target="${target}"]`).first().hover();
}

/** Playhead position in columns, as reported by the timeline. */
export async function playheadX(page: Page): Promise<number> {
  return Number(await page.getByTestId('tl-playhead').getAttribute('data-x'));
}

/** Put keyboard focus on the timeline so ←/→/Home/End move the playhead. */
export async function focusTimeline(page: Page): Promise<void> {
  await page.getByTestId('timeline').focus();
}

/**
 * Drag a source onto a target element at the given horizontal zone:
 * 'before' = left third, 'same' = middle, 'after' = right third (see TimelinePanel zoneFor).
 */
export async function dragToZone(source: Locator, target: Locator, zone: 'before' | 'same' | 'after', sourcePosition?: { x: number; y: number }): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('drop target has no bounding box');
  const x = zone === 'before' ? box.width * 0.15 : zone === 'same' ? box.width * 0.5 : box.width * 0.85;
  await source.dragTo(target, { targetPosition: { x, y: box.height / 2 }, sourcePosition });
}

/** Make sure the left World panel (entity browser) is showing. */
export async function showWorld(page: Page): Promise<void> {
  if (await page.getByTestId('world-filter').isVisible()) return;
  await page.getByTestId('act-wiki').click();
  await expect(page.getByTestId('world-filter')).toBeVisible();
}

/** Is an entity type listed in the World panel's type dropdown? Leaves the dropdown closed. */
export async function typeListed(page: Page, name: string): Promise<boolean> {
  await showWorld(page);
  await page.getByTestId('type-select').click();
  const listed = (await page.locator(`[data-testid="type-option"][data-type="${name}"]`).count()) > 0;
  await page.keyboard.press('Escape');
  return listed;
}

/** Filter the World panel to one entity type via its dropdown. */
export async function selectType(page: Page, name: string): Promise<void> {
  await showWorld(page);
  await page.getByTestId('type-select').click();
  await page.locator(`[data-testid="type-option"][data-type="${name}"]`).click();
}

/** A cast card in the quick panel, opened: cards are one line until clicked. Safe to call on an open card. */
export async function openCastCard(page: Page, name: string): Promise<Locator> {
  const card = page.locator(`[data-testid="cast-card"][data-entity="${name}"]`);
  await expect(card).toBeVisible();
  if ((await card.getAttribute('data-open')) !== 'true') await card.getByTestId('cast-head').click();
  return card;
}

/** The scene that is open: scenes in a chapter share the chapter's document, so the quick panel names the open one. */
export async function expectOpenScene(page: Page, title: string): Promise<void> {
  await expect(page.locator('[data-testid="insp-scene"] .insp-scene-title')).toContainText(title);
}

/** Gives an entity page the old State slider instead of following the timeline (the "State panel time" setting). */
export async function useStateSlider(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('lw-ui-stateTime', '"slider"'));
}
