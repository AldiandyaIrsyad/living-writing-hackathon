import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('a place’s page lists who is there, from their location property', async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-presence-'));
  fs.mkdirSync(path.join(root, 'Places'));
  fs.mkdirSync(path.join(root, 'People'));
  fs.writeFileSync(path.join(root, 'Places', 'Ashford.md'), 'A walled town.\n');
  fs.writeFileSync(path.join(root, 'Places', 'Dover.md'), 'A port.\n');
  fs.writeFileSync(path.join(root, 'People', 'Mira.md'), '---\nlocation: Ashford\n---\nA scout.\n');
  fs.writeFileSync(path.join(root, 'People', 'Norman.md'), '---\nlocation: Dover\n---\nAn old man.\n');

  await page.goto('/');
  await page.getByTestId('home-import-notes').click();
  await page.getByTestId('import-notes-folder-input').setInputFiles(root);
  await page.getByTestId('import-notes-apply').click();

  await page.keyboard.press('Control+k');
  await page.keyboard.type('@Ashford');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('entity-name')).toHaveValue('Ashford');
  await expect(page.getByTestId('presence-entry')).toHaveText(['Mira']);

  await page.keyboard.press('Control+k');
  await page.keyboard.type('@Mira');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('entity-name')).toHaveValue('Mira');
  await expect(page.getByTestId('presence-panel')).toHaveCount(0); // Mira is a person; nobody is "at" her
});
