import { expect, test } from '@playwright/test';
import { clip, expectOpenScene, focusTimeline, loadDemo, openCastCard, openEntity, openScene } from './helpers';

// Workspace behaviour from SPEC §3 / §6.3: the Cast, commits, timeline tracks, focus mode.

test.describe('the Cast (Inspector)', () => {
  test('follows the open scene, then the playhead when no scene is open', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Fall of Ashford');
    const norman = page.locator('[data-testid="cast-card"][data-entity="Norman"]');
    // Cast cards are one line until clicked: no state and no commit buttons yet.
    await expect(norman).toContainText('Norman');
    await expect(norman.getByTestId('commit-open')).toHaveCount(0);
    await openCastCard(page, 'Norman');
    // Entering the scene, the Fall has not happened yet.
    await expect(norman).toContainText('status: alive');
    await expect(norman).toContainText('Falls defending the inn');

    // Close the document: the Cast now shows the point under the playhead (start of the Fall).
    await page.getByRole('tab', { name: /Chapter 5/ }).getByLabel('Close tab').click();
    await expect(page.getByTestId('cast-time')).toContainText('Playhead');
    await openCastCard(page, 'Norman');
    await expect(norman).toContainText('status: alive');

    await focusTimeline(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tl-playhead')).toHaveAttribute('data-x', '7');
    await openCastCard(page, 'Norman');
    await expect(norman).toContainText('status: dead');
  });

  test('is empty for an empty scene and picks up [[links]] as you type', async ({ page }) => {
    await loadDemo(page);
    const supper = clip(page, 'Supper at the Inn');
    await supper.hover();
    await supper.getByTestId('tl-insert-after').click();
    await expect(page.getByTestId('scene-title')).toHaveValue('Untitled scene');
    await expect(page.getByTestId('cast-empty')).toBeVisible();

    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.type('[[Bob]] waits by the door.');
    await expect(page.locator('[data-testid="cast-card"][data-entity="Bob"]')).toBeVisible();
    await expect(page.getByTestId('cast-empty')).toHaveCount(0);
  });

  test('a commit made from the Cast shows up in the entity history', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Gathering Storm');
    const mira = await openCastCard(page, 'Mira');
    await mira.getByTestId('commit-open').click();
    await mira.getByTestId('commit-message').fill('Hides the coins under the floorboards');
    await mira.getByTestId('commit-submit').click();
    await expect(mira.getByTestId('cast-here').filter({ hasText: 'Hides the coins under the floorboards' })).toBeVisible();

    await openEntity(page, 'Mira');
    await expect(page.getByTestId('history-entry').filter({ hasText: 'Hides the coins under the floorboards' })).toBeVisible();
  });
});

test.describe('edits on the timeline', () => {
  test('a commit from the Cast sits at a timeline column and shifts with a gap, not with the scene', async ({ page }) => {
    await loadDemo(page);
    const storm = clip(page, 'Gathering Storm');
    const col = Number(await storm.getAttribute('data-column'));
    await openScene(page, 'Gathering Storm');
    const mira = await openCastCard(page, 'Mira');
    await mira.getByTestId('commit-open').click();
    await expect(mira.getByTestId('anchor-note')).toContainText(`after column ${col + 1}`);
    await mira.getByTestId('commit-message').fill('Hides the coins under the floorboards');
    await mira.getByTestId('commit-submit').click();

    await openEntity(page, 'Mira');
    const entry = page.getByTestId('history-entry').filter({ hasText: 'Hides the coins under the floorboards' });
    await expect(entry).toContainText(`after column ${col + 1}`);

    // A gap opened before the scene pushes the scene and the commit one column right together.
    await storm.click({ button: 'right' });
    await page.getByTestId('tl-context-item').filter({ hasText: 'Insert gap before this scene' }).click();
    await expect(storm).toHaveAttribute('data-column', String(col + 1));
    await expect(entry).toContainText(`after column ${col + 2}`);
  });
});

test.describe('timeline tracks and focus mode', () => {
  test('a story can be removed from the timeline and added back', async ({ page }) => {
    await loadDemo(page);
    const track = page.locator('[data-testid="tl-track"][data-story="Mira\'s Road"]');
    await expect(track).toBeVisible();
    await track.getByTestId('tl-track-remove').click();
    await expect(track).toHaveCount(0);
    await expect(clip(page, 'Crossroads')).toHaveCount(0);

    await page.getByTestId('tl-add-track').click();
    await page.locator('[data-testid="tl-add-track-option"][data-story="Mira\'s Road"]').click();
    await expect(track).toBeVisible();
    await expect(clip(page, 'Crossroads')).toBeVisible();
  });

  test('typing in a scene auto-hides the timeline; Ctrl+J brings it back', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await expect(page.getByTestId('timeline')).toBeVisible();

    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' The fire crackles.');
    await expect(page.getByTestId('tl-strip')).toBeVisible();
    await expect(page.getByTestId('timeline')).toHaveCount(0);

    await page.keyboard.press('Control+j');
    await expect(page.getByTestId('timeline')).toBeVisible();
  });

  test('the "Always show" behaviour keeps the timeline while typing', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('tl-settings').click();
    await page.getByTestId('tl-behaviour-always').click();
    await openScene(page, 'Supper at the Inn');
    await page.getByTestId('scene-editor').locator('.cm-content').click();
    await page.keyboard.type('x');
    await expect(page.getByTestId('timeline')).toBeVisible();
    await expect(page.getByTestId('tl-strip')).toHaveCount(0);
  });
});

test.describe('focus writing', () => {
  test('Focus hides the panels and timeline; Esc brings them back', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await page.getByTestId('zen-toggle').click();
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    await expect(page.getByTestId('timeline')).toHaveCount(0);
    await expect(page.getByTestId('scene-editor')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('inspector')).toBeVisible();
    await expect(page.getByTestId('timeline')).toBeVisible();
  });
});

test.describe('right pane', () => {
  test('can be minimized to a rail and restored', async ({ page }) => {
    await loadDemo(page);
    await expect(page.getByTestId('inspector')).toBeVisible();
    await page.getByTestId('right-minimize').click();
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    await page.getByTestId('right-rail').click();
    await expect(page.getByTestId('inspector')).toBeVisible();
  });
});

test.describe('empty chapters', () => {
  test('an empty chapter in the outline offers its first scene', async ({ page }) => {
    await loadDemo(page);
    await page.getByTestId('story-picker').click();
    await page.getByTestId('story-option').filter({ hasText: "Mira's Road" }).click();
    await page.getByRole('button', { name: 'Open story page' }).click();
    await page.getByLabel('New chapter title').fill('Prologue');
    await page.getByTestId('add-chapter').click();

    await page.getByTestId('add-scene-in-chapter').click();
    await expect(page.getByTestId('scene-editor')).toBeVisible();
    await expect(page.getByTestId('insp-scene')).toContainText('Prologue');
    await expect(page.getByTestId('add-scene-in-chapter')).toHaveCount(0);
  });
});

test.describe('tabs', () => {
  test('Close all closes every open document and returns to the home page', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'Supper at the Inn');
    await openScene(page, 'The Stranger');
    await expect(page.getByTestId('tab')).toHaveCount(2);

    await page.getByTestId('close-all-tabs').click();
    await expect(page.getByTestId('tab')).toHaveCount(0);
    await expect(page.getByTestId('scene-editor')).toHaveCount(0);
    await expect(page.getByTestId('home-new-story')).toBeVisible();
  });
});

test.describe('chapter documents', () => {
  test('a typed # heading becomes a scene; the cursor decides the open scene; deleting the heading merges it upward', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    await expect(page.getByTestId('chapter-title')).toHaveValue('Chapter 2');
    const editor = page.getByTestId('scene-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n# The knock\n\nHe opens the door.');

    await expect(page.getByTestId('side-scene').filter({ hasText: 'The knock' })).toBeVisible();
    await expectOpenScene(page, 'The knock');
    await expect(page.getByTestId('chapter-words')).toContainText('2 scenes');

    // Moving the cursor into the first scene's text makes that scene the open one.
    await page.locator('.cm-line').filter({ hasText: 'A stranger comes in' }).click({ position: { x: 5, y: 5 } });
    await expectOpenScene(page, 'The Stranger');

    // Deleting the heading folds the scene, and what it held, into the one above.
    // The `# ` is hidden while the cursor is elsewhere, and shown once it is on that line.
    const heading = page.locator('.cm-line').filter({ hasText: 'The knock' });
    await expect(heading).toHaveText('The knock');
    await heading.click();
    await expect(heading).toHaveText('# The knock');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('side-scene').filter({ hasText: 'The knock' })).toHaveCount(0);
    await expectOpenScene(page, 'The Stranger');
    await expect(editor).toContainText('He opens the door.');
    await expect(page.getByTestId('chapter-words')).toContainText('1 scene ');
  });
});

test.describe('left panel outline', () => {
  test('chapters start closed; Expand all shows every scene and Collapse all hides them again', async ({ page }) => {
    await loadDemo(page);
    const scenes = page.getByTestId('side-scene');
    const toggle = page.getByTestId('outline-toggle-all');
    await expect(page.locator('.lp-chapter').first()).toBeVisible();
    await expect(scenes).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toContainText('Collapse all');
    await expect(scenes.filter({ hasText: 'Supper at the Inn' })).toBeVisible();
    await expect(scenes.filter({ hasText: 'The Betrayal' })).toBeVisible();

    await toggle.click();
    await expect(toggle).toContainText('Expand all');
    await expect(scenes).toHaveCount(0);
  });

  test('a chapter title opens the chapter without unfolding it; only its arrow folds and unfolds', async ({ page }) => {
    await loadDemo(page);
    const row = page.locator('.lp-chapter').filter({ hasText: 'Chapter 2' });
    await row.getByTestId('outline-open').click();
    await expect(page.getByTestId('scene-editor')).toBeVisible();
    await expect(page.getByTestId('chapter-title')).toHaveValue('Chapter 2');
    await expect(page.getByTestId('side-scene')).toHaveCount(0);

    await row.getByTestId('outline-fold').click();
    await expect(page.getByTestId('side-scene').filter({ hasText: 'The Stranger' })).toBeVisible();
    await expect(page.getByTestId('chapter-title')).toHaveValue('Chapter 2');
    await row.getByTestId('outline-fold').click();
    await expect(page.getByTestId('side-scene')).toHaveCount(0);
  });

  test('opening a scene from the timeline opens its chapter in the outline', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    await expect(page.getByTestId('side-scene').filter({ hasText: 'The Stranger' })).toBeVisible();
    await expect(page.getByTestId('side-scene').filter({ hasText: 'The Betrayal' })).toHaveCount(0);
  });
});

test.describe('formatting toolbar', () => {
  test('selecting text shows a toolbar whose Bold button wraps it, and Ctrl+B toggles it off again', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    const line = page.locator('.cm-line').filter({ hasText: 'comes in from the rain' });
    await line.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+Control+ArrowRight');
    const bubble = page.locator('.cm-bubble');
    await expect(bubble).toBeVisible();
    await bubble.getByRole('button', { name: /^Bold/ }).click();
    await expect(line).toContainText('**A**');
    await page.keyboard.press('Control+b');
    await expect(line).not.toContainText('**');
  });
});

test.describe('cast scope in a chapter', () => {
  test('shows everyone in the chapter by default, and narrows to the open scene or a chosen one', async ({ page }) => {
    await loadDemo(page);
    await openScene(page, 'The Stranger');
    const editor = page.getByTestId('scene-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n# The knock\n\n[[Bob]] opens the door.');
    await expectOpenScene(page, 'The knock');

    const count = async () => Number(await page.getByTestId('cast-count').innerText());
    const card = (name: string) => page.locator(`[data-testid="cast-card"][data-entity="${name}"]`);
    const scope = page.getByTestId('cast-scope');

    // The Stranger has four people and the new scene one of them: the chapter is the four, once each.
    await expect(scope).toHaveValue('chapter');
    await expect.poll(count).toBe(4);
    await expect(card('Mira')).toBeVisible();

    await scope.selectOption('current');
    await expect.poll(count).toBe(1);
    await expect(card('Mira')).toHaveCount(0);

    // From a card in the chapter view, its scenes narrow the cast to that scene.
    await scope.selectOption('chapter');
    const bob = await openCastCard(page, 'Bob');
    await bob.getByTestId('cast-in').getByRole('button', { name: 'The Stranger' }).click();
    await expect.poll(count).toBe(4);
    await expect(scope).toHaveValue(/^(?!chapter$|current$).+/);
  });
});

