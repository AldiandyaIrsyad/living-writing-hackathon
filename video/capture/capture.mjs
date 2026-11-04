// Captures the real app for the demo film: 2x screenshots of each state the storyboard needs, plus element
// boxes (CSS px, viewport space) in public/textures/layout.json. Runs against `npm run dev:full` on :5173.
//
//   node video/capture/capture.mjs <step> [<step> ...]
//
// The browser profile is kept in capture/.profile so later steps see what earlier ones did (sign-in, the
// vault on the server, Flow readings in localStorage). Steps run in the order given.
//
// Test account for the film, local dev server only: film@example.com / "correct horse" (the e2e tests'
// password). Data shown is the bundled public demo vault plus lines typed here.

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'textures');
const LAYOUT = join(OUT, 'layout.json');
const BASE = 'http://localhost:5173';
const EMAIL = 'film@example.com';
const PASSWORD = 'correct horse';
const MODEL = 'muse-spark-1.3';
mkdirSync(OUT, { recursive: true });

const layout = existsSync(LAYOUT) ? JSON.parse(readFileSync(LAYOUT, 'utf8')) : {};
const saveLayout = () => writeFileSync(LAYOUT, JSON.stringify(layout, null, 2));

const ctx = await chromium.launchPersistentContext(join(HERE, '.profile'), {
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('dialog', (d) => void d.accept());
page.setDefaultTimeout(20_000);

const tid = (id) => page.getByTestId(id);
const settle = async (ms = 600) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
};

/** Viewport box of an element, CSS px. */
async function box(locator) {
  if (!(await locator.count())) return null;
  const b = await locator.first().boundingBox();
  return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}

/** Full-viewport 2x screenshot `name`, with the boxes of `els` ({ key: locator }) recorded under it. */
async function shot(name, els = {}) {
  await settle();
  const boxes = {};
  for (const [k, l] of Object.entries(els)) boxes[k] = await box(l);
  await page.mouse.move(1919, 1079); // no hover states left behind
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  layout[name] = { pageH: 1080, ...boxes };
  saveLayout();
  console.log('shot', name, Object.keys(boxes).join(' '));
}

/** 2x cutout of one element, saved as `name`.png with its box. */
async function cut(name, locator) {
  await settle(300);
  await locator.first().screenshot({ path: join(OUT, `${name}.png`) });
  layout[name] = { cutout: true, ...(await box(locator)) };
  saveLayout();
  console.log('cut', name);
}

const clip = (title) => page.locator(`[data-testid="tl-scene"][data-scene="${title}"]`);
async function openScene(title) {
  await clip(title).first().click();
  await tid('scene-editor').waitFor();
}
async function openEntity(name) {
  if (!(await tid('world-filter').isVisible())) await tid('act-wiki').click();
  await tid('world-filter').fill(name);
  await page.locator(`[data-testid="side-entity"][data-name="${name}"]`).click();
  await tid('world-filter').fill('');
}
const editor = () => tid('scene-editor').locator('.cm-content');

async function signIn() {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  if (!(await tid('login-form').isVisible().catch(() => false))) return;
  await tid('login-email').fill(EMAIL);
  await tid('login-password').fill(PASSWORD);
  await tid('login-submit').click();
  await page.waitForTimeout(1500);
  if (await tid('login-form').isVisible().catch(() => false)) {
    await tid('login-switch').click();
    await tid('login-email').fill(EMAIL);
    await tid('login-password').fill(PASSWORD);
    await tid('login-submit').click();
  }
  await tid('vault-menu').waitFor();
}

/** A clean demo vault, the agent on the non-contributor model with its settings folded away. */
async function reset() {
  await tid('vault-menu').click();
  await tid('load-demo').click();
  await clip('Supper at the Inn').first().waitFor();
  await openScene('The Stranger');
  const settings = tid('agent-settings');
  if (!(await settings.evaluate((d) => d.open))) await settings.locator('summary').click();
  await tid('agent-model').selectOption(MODEL);
  await settings.locator('summary').click();
  await page.waitForTimeout(1500);
}

const steps = {
  async peek() {
    await shot('peek');
  },

  async desk() {
    await openScene('The Stranger');
    await shot('desk', {
      editor: tid('scene-editor'),
      inspector: tid('inspector'),
      timeline: tid('timeline'),
      outline: page.locator('.left, [data-testid="sidebar"]').first(),
    });
  },

  /** S04: the line typed into The Stranger, a frame every few characters. */
  async typing() {
    await openScene('The Stranger');
    const line = ' [[Nora]] came in out of the rain. Norman had never set foot in Ashford.';
    await editor().click();
    await page.keyboard.press('Control+End');
    await shot('type-00', { editor: tid('scene-editor') });
    let n = 0;
    for (let i = 0; i < line.length; i += 6) {
      await page.keyboard.type(line.slice(i, i + 6), { delay: 15 });
      n++;
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `type-${String(n).padStart(2, '0')}.png`) });
    }
    layout.typing = { frames: n + 1 };
    saveLayout();
    await shot('typed', { editor: tid('scene-editor'), check: tid('agent-read'), nora: page.locator('.cm-wikilink[data-link-target="Nora"]') });
  },

  /** S05/S06: Check, the reading under way, then the report. */
  async check() {
    await tid('agent-read').click();
    await page.waitForTimeout(400);
    await shot('checking', { check: tid('agent-read'), agent: tid('insp-agent') });
    await tid('agent-report').waitFor({ timeout: 180_000 });
    await shot('report', {
      agent: tid('insp-agent'),
      report: tid('agent-report'),
      contradiction: tid('agent-contradiction'),
      takeBack: page.getByRole('button', { name: /Take back \d+ changes?/ }),
      nora: page.locator('.cm-wikilink[data-link-target="Nora"]'),
    });
    const filed = page.locator('[data-testid="agent-report"] .agent-filed').first();
    if (await filed.count()) await cut('cut-report-filed', filed);
    if (await tid('agent-contradiction').count()) await cut('cut-contradiction', tid('agent-contradiction'));
    await cut('cut-agent', tid('insp-agent'));
  },

  /** S07: Take back. */
  async takeback() {
    const btn = page.getByRole('button', { name: /Take back \d+ changes?/ });
    await btn.hover();
    await shot('takeback-hover', { takeBack: btn, agent: tid('insp-agent') });
    await btn.click();
    await shot('takeback-after', { agent: tid('insp-agent'), nora: page.locator('.cm-wikilink[data-link-target="Nora"]') });
  },

  /** S08: the timeline, fitted. */
  async tracks() {
    await openScene('The Stranger');
    await page.keyboard.press('Escape');
    const fit = page.getByRole('button', { name: 'Fit', exact: true });
    if (await fit.isVisible().catch(() => false)) await fit.click();
    await shot('tracks', { timeline: tid('timeline') });
  },

  /** S09: cast cards as the world stands at each chapter, expanded. */
  async castcards() {
    const cards = [
      ['Supper at the Inn', 'Norman', 'cast-ch1-norman'],
      ['The Betrayal', 'Alice', 'cast-ch3-alice'],
      ['Gathering Storm', 'Mira', 'cast-ch4-mira'],
      ['The Fall of Ashford', 'Norman', 'cast-ch5-norman'],
      ['The Fall of Ashford', 'Ashford', 'cast-ch5-ashford'],
    ];
    for (const [scene, entity, name] of cards) {
      await openScene(scene);
      const card = page.locator(`[data-testid="cast-card"][data-entity="${entity}"]`);
      if ((await card.getAttribute('data-open')) !== 'true') await card.getByTestId('cast-head').click();
      await cut(name, card);
      await card.getByTestId('cast-head').click();
    }
  },

  /**
   * S09: an entity's State panel at the end of the story and at its start. The entity page follows the
   * playhead; opening the last scene puts it at chapter 5, and "Previous change" steps it back.
   */
  async states() {
    // [entity, text that shows its last state]
    for (const [entity, end] of [['Norman', 'dead'], ['Alice-Bob', 'enemies'], ['Ashford', 'ruined']]) {
      await openScene('Supper at the Inn');
      await openEntity(entity);
      const slug = entity.toLowerCase();
      await cut(`state-start-${slug}`, tid('entity-state'));
      for (let i = 0; i < 8 && !(await tid('entity-state').innerText()).includes(end) && (await tid('key-next').isEnabled()); i++) await tid('key-next').click();
      await cut(`state-end-${slug}`, tid('entity-state'));
    }
  },

  /** S10: Mira's page before her revision in Gathering Storm, and after it. */
  async versions() {
    await openScene('The Stranger');
    await openEntity('Mira');
    await shot('mira-before', { page: tid('page-panel'), time: tid('entity-time-label'), state: tid('entity-state') });
    await cut('cut-mira-before', tid('page-panel'));
    for (let i = 0; i < 6 && !(await tid('page-panel').innerText()).includes('hair short') && (await tid('key-next').isEnabled()); i++) await tid('key-next').click();
    await shot('mira-after', { page: tid('page-panel'), time: tid('entity-time-label'), state: tid('entity-state') });
    await cut('cut-mira-after', tid('page-panel'));
  },

  /** S11: a flashback that shows something before it is true. */
  async flashback() {
    await openScene('Crossroads');
    await editor().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Her hair, already cut short for the road, is plastered to her face by the rain.', { delay: 10 });
    await shot('flashback-typed', { editor: tid('scene-editor') });
    await tid('agent-read').click();
    await tid('agent-report').waitFor({ timeout: 180_000 });
    await shot('flashback-report', { agent: tid('insp-agent'), contradiction: tid('agent-contradiction'), editor: tid('scene-editor') });
    if (await tid('agent-contradiction').count()) await cut('cut-flashback', tid('agent-contradiction'));
    const btn = page.getByRole('button', { name: /Take back \d+ changes?/ });
    if (await btn.count()) await btn.click();
    await page.keyboard.press('Control+Z');
  },

  /** S11: the changes a scene makes to the world, opened from the bar above its text. */
  async changes() {
    await openScene('The Fall of Ashford');
    await shot('fall-closed', { changes: page.getByRole('button', { name: /^Changes \(/ }) });
    await page.getByRole('button', { name: /^Changes \(/ }).click();
    await shot('fall-changes', { changes: page.getByRole('button', { name: /^Changes \(/ }) });
  },

  /** S12/S13: Flow readings for four scenes; The Betrayal's panel captured. */
  async flow() {
    const out = {};
    for (const title of ['Supper at the Inn', 'The Betrayal', 'Gathering Storm', 'The Fall of Ashford']) {
      await openScene(title);
      await tid('flow-read').click();
      await page.waitForFunction(() => !document.querySelector('[data-testid=flow-read]')?.disabled, null, { timeout: 180_000 });
      await tid('flow-reading').waitFor();
      out[title] = await tid('flow-reading').innerText();
      if (title === 'The Betrayal') {
        await shot('flow-betrayal', { flow: tid('insp-flow'), reading: tid('flow-reading'), role: tid('flow-role') });
        await cut('cut-flow', tid('insp-flow'));
        await cut('cut-flow-role', tid('flow-role'));
      }
    }
    out.stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lw-flow-readings-v1') ?? '{}'));
    writeFileSync(join(HERE, 'flow-readings.json'), JSON.stringify(out, null, 2));
  },

  /** S14: a placeholder portrait of Norman. */
  async portrait() {
    await openEntity('Norman');
    await shot('norman-page', { portrait: tid('entity-make-portrait') });
    await tid('entity-make-portrait').click();
    await tid('illustrate-dialog').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid=illustrate-drafting]'), null, { timeout: 120_000 });
    const style = tid('illustrate-style');
    if (await style.isVisible().catch(() => false)) await style.selectOption({ label: 'Ink sketch' }).catch(() => {});
    await shot('portrait-draft', { dialog: tid('illustrate-dialog'), make: tid('illustrate-make') });
    await tid('illustrate-make').click();
    await tid('illustrate-picture').waitFor({ timeout: 240_000 });
    await shot('portrait-made', { dialog: tid('illustrate-dialog'), picture: tid('illustrate-picture') });
    await tid('illustrate-keep').click();
    await shot('portrait-kept', { portrait: tid('entity-portrait') });
    await cut('cut-portrait', tid('entity-portrait'));
  },

  /** S15: Ctrl+K, dark theme, the Vault menu. */
  async montage() {
    await openScene('The Betrayal');
    await page.keyboard.press('Control+k');
    await page.keyboard.type(':3.1', { delay: 120 });
    await shot('palette');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await shot('dark');
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await tid('vault-menu').click();
    await shot('vault-menu', { exportZip: tid('export-zip') });
    await page.keyboard.press('Escape');
  },

  /** S15: the 2,000-scene sample. Replaces the vault: run last, then reset. */
  async large() {
    if (!(await tid('load-large').isVisible().catch(() => false))) await tid('vault-menu').click();
    await tid('load-large').click();
    await page.waitForTimeout(8000);
    const fit = page.getByRole('button', { name: 'Fit', exact: true });
    if (await fit.isVisible().catch(() => false)) await fit.click();
    await shot('large', { timeline: tid('timeline') });
  },
};

await signIn();
for (const name of process.argv.slice(2)) {
  if (name === 'reset') await reset();
  else if (steps[name]) await steps[name]();
  else console.error('unknown step', name);
}
await ctx.close();
