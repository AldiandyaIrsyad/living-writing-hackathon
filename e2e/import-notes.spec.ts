import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitSaved } from './helpers';

function makeNotes(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-notes-'));
  fs.mkdirSync(path.join(root, 'Characters'));
  fs.mkdirSync(path.join(root, 'Places'));
  fs.mkdirSync(path.join(root, '.obsidian'));
  fs.writeFileSync(path.join(root, 'Characters', 'Norman.md'), '---\r\naliases: [Old Norm]\r\nrole: wanderer\r\n---\r\nLives in [[Places/Ashford|the town]] and fears [[Ghost]].\r\n');
  fs.writeFileSync(path.join(root, 'Places', 'Ashford.md'), 'A walled town.\n');
  fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), '{}');
  return root;
}

test('importing a folder of notes shows a report first, then makes linked pages in one undoable step', async ({ page }) => {
  const dir = makeNotes();
  await page.goto('/');
  await page.getByTestId('home-import-notes').click();
  await page.getByTestId('import-notes-folder-input').setInputFiles(dir);

  await expect(page.getByTestId('import-notes-summary')).toContainText('2 notes: 2 new pages, 0 already exist');
  await expect(page.getByTestId('import-notes-report')).toContainText('New types: Character');
  await expect(page.getByTestId('import-notes-report')).toContainText('1 lead somewhere, 1 target leads nowhere (Ghost)');
  // Nothing has been written yet.
  await expect(page.getByTestId('import-notes-dialog')).toBeVisible();

  await page.getByTestId('import-notes-apply').click();
  await expect(page.getByText(/Imported 2 new and updated 0 existing pages, plus 1 empty page/)).toBeVisible();
  await waitSaved(page);

  // The pages are there and findable by their alias.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('@old norm');
  await expect(page.locator('.switcher').getByRole('option', { name: /Norman/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // One undo takes the whole import back.
  await page.getByTestId('undo').click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('@Norman');
  await expect(page.locator('.switcher').getByRole('option', { name: /Create entity/ })).toBeVisible(); // no page by that name any more
});
