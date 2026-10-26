import { expect, test, type Page } from '@playwright/test';
import { loadDemo, openScene } from './helpers';

// Typewriter scrolling keeps the line being written near the vertical middle of whatever scrolls the editor.
async function caretOffsetFromMiddle(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sel = window.getSelection()!;
    const caret = sel.getRangeAt(0).getBoundingClientRect();
    const el = sel.anchorNode as Node | null;
    let box: HTMLElement | null = el instanceof HTMLElement ? el : (el?.parentElement ?? null);
    while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement;
    const r = (box ?? document.documentElement).getBoundingClientRect();
    return Math.abs(caret.top + caret.height / 2 - (r.top + Math.min(r.height, window.innerHeight) / 2));
  });
}

test('with typewriter scrolling on, the line being written stays near the middle', async ({ page }) => {
  await loadDemo(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>typewriter');
  await page.keyboard.press('Enter');
  await openScene(page, 'The Fall of Ashford');
  await page.getByTestId('scene-editor').locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(Array.from({ length: 60 }, (_, i) => `Line ${i} of a long scene.`).join('\n\n') + '\n\n');
  await page.keyboard.type('The last line.'); // a caret on an empty line has no measurable position
  await expect.poll(() => caretOffsetFromMiddle(page)).toBeLessThan(120);
});
