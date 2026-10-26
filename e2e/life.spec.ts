import { expect, test } from '@playwright/test';
import { loadDemo, openEntity } from './helpers';

test('an entity page tells the character’s life in story order, with the death in the last scene', async ({ page }) => {
  await loadDemo(page);
  await openEntity(page, 'Norman');
  const life = page.getByTestId('life-panel');
  await expect(life.getByTestId('life-change')).toHaveText(['status: alive → dead.']);
  await expect(life.getByTestId('life-step').filter({ hasText: 'status: alive → dead' })).toContainText('The Fall of Ashford');

  await life.getByTestId('life-quiet').check();
  const titles = await life.getByTestId('life-step').locator('button').allTextContents();
  expect(titles.at(-1)).toContain('The Fall of Ashford');
  expect(titles.length).toBeGreaterThan(1);
});
