import { expect, test } from '@playwright/test';
import { loadDemo, openScene, waitSaved } from './helpers';

test('quick capture files an idea in the Inbox and leaves the caret and scroll where they were', async ({ page }) => {
  await loadDemo(page);
  await openScene(page, 'The Stranger');
  const editor = page.getByTestId('scene-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nLong tail. ');
  const top = async () => (await editor.locator('.cm-line').first().boundingBox())!.y;
  const y = await top();

  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByTestId('capture-input')).toBeFocused();
  await page.keyboard.type('Norman owes a debt');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('capture-box')).toHaveCount(0);
  await expect(page.getByTestId('inbox-badge')).toHaveText('Inbox (1)');

  // The caret is still at the end of the prose, so the next keystrokes land there.
  await page.keyboard.type('and on.');
  await expect(editor).toContainText('Long tail. and on.');
  expect(await top()).toBe(y);

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('inbox-badge')).toHaveText('Inbox (1)');
  await page.getByTestId('inbox-badge').click();
  await expect(page.getByTestId('note-preview')).toContainText('Norman owes a debt (from The Stranger)'); // the link is shown as its words

  // The Idea Queue deck is mounted on the Inbox page: add a second idea with syntax, shuffle, view code, mark done, and graduate.
  await expect(page.getByTestId('idea-queue-panel')).toBeVisible();
  await page.getByTestId('idea-quick-input').fill('[[Norman@latest]] finds #clue // check timeline');
  await page.getByTestId('idea-quick-submit').click();
  await expect(page.getByTestId('inbox-badge')).toHaveText('Inbox (2)');
  await expect(page.getByTestId('idea-card-pos')).toHaveText('Idea 2 of 2');
  await expect(page.getByTestId('idea-author-notes')).toContainText('check timeline');

  // Toggle raw code view
  await page.getByTestId('idea-toggle-code').click();
  await expect(page.getByTestId('idea-code-view')).toContainText('[[Norman@latest]] finds #clue // check timeline');
  await page.getByTestId('idea-toggle-code').click();

  // Shuffle switches to the other active idea (since pickRandomIdeaIndex avoids the current idea when >= 2)
  await page.getByTestId('idea-shuffle').click();
  await expect(page.getByTestId('idea-card-pos')).toHaveText('Idea 1 of 2');

  // Mark Idea 1 done -> active count drops to 1
  await page.getByTestId('idea-mark-done').click();
  await expect(page.getByTestId('inbox-badge')).toHaveText('Inbox (1)');
  await expect(page.getByTestId('idea-card-pos')).toHaveText('Idea 1 of 1');

  // Graduate the remaining active idea into a Someday scene
  await page.getByTestId('idea-promote-scene-btn').click();
  await page.getByTestId('idea-promote-scene-title').fill('The Clue Scene');
  await page.getByTestId('idea-promote-confirm').click();
  await expect(page.getByTestId('scene-editor')).toContainText('finds #clue');
});

test('Escape closes the capture box without filing anything', async ({ page }) => {
  await loadDemo(page);
  await page.keyboard.press('Control+Shift+Space');
  await page.keyboard.type('never mind');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('capture-box')).toHaveCount(0);
  await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
});
