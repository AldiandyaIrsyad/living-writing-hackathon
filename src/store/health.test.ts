import { describe, expect, it } from 'vitest';
import { describeStorage, safetySummary, storageHealth } from './health';

describe('storageHealth', () => {
  const roomy = { usage: 10, quota: 1000 };

  it('is fine when the browser keeps the storage, or a folder holds a second copy', () => {
    expect(storageHealth({ persisted: true, ...roomy, folderOk: false }).level).toBe('ok');
    expect(storageHealth({ persisted: false, ...roomy, folderOk: true }).level).toBe('ok');
  });

  it('warns when storage is volatile and nothing else holds a copy, including when the browser cannot say', () => {
    expect(storageHealth({ persisted: false, ...roomy, folderOk: false }).level).toBe('warn');
    expect(storageHealth({ persisted: null, folderOk: false }).level).toBe('warn');
  });

  it('a nearly full quota outranks everything, even a healthy folder', () => {
    expect(storageHealth({ persisted: true, usage: 950, quota: 1000, folderOk: true }).level).toBe('critical');
    expect(storageHealth({ persisted: true, usage: 800, quota: 1000, folderOk: true }).level).toBe('warn');
    expect(storageHealth({ persisted: true, usage: 799, quota: 1000, folderOk: true }).level).toBe('ok');
  });

  it('ignores an unusable quota instead of dividing by it', () => {
    expect(storageHealth({ persisted: true, usage: 5, quota: 0, folderOk: false }).level).toBe('ok');
  });
});

describe('describeStorage', () => {
  it('says whether the browser keeps the data and how full it is', () => {
    expect(describeStorage({ persisted: true, usage: 14_000_000, quota: 2_000_000_000 })).toBe('Kept by the browser · 14 MB of 2.0 GB used');
    expect(describeStorage({ persisted: false })).toBe('Not guaranteed by the browser');
  });

  it('shows a tiny vault as at least 1 MB rather than 0', () => {
    expect(describeStorage({ persisted: null, usage: 1200, quota: 5_000_000_000 })).toBe('Browser storage · 1 MB of 5.0 GB used');
  });
});

describe('safetySummary: the one answer to "is my work safe?"', () => {
  const fine = { save: 'saved', savedAt: 1, folder: { status: 'synced', name: 'Novel', lastSync: 2 }, storage: { level: 'ok', detail: 'Kept by the browser', reason: '' } } as const;
  const bad = (patch: object) => safetySummary({ ...fine, ...patch } as Parameters<typeof safetySummary>[0]);

  it('says yes, and where the work lives, when nothing is wrong', () => {
    expect(safetySummary(fine).level).toBe('ok');
    expect(safetySummary(fine).headline).toContain('in this browser and in the folder');
    expect(bad({ folder: { status: 'off' } }).headline).toBe('Your work is safe in this browser.');
  });

  it.each([
    ['a failed save', { save: 'error' }, 'critical', /Saving to this browser failed/],
    ['a failed folder sync', { folder: { status: 'error', name: 'Novel' } }, 'critical', /Syncing to Novel failed/],
    ['storage nearly full', { storage: { level: 'critical', detail: 'd', reason: 'Browser storage is almost full.' } }, 'critical', /almost full/],
    ['a folder that needs permission', { folder: { status: 'needs-permission', name: 'Novel' } }, 'warn', /permission/],
    ['a folder changed outside', { folder: { status: 'changed', name: 'Novel' } }, 'warn', /changed outside/],
    ['storage filling up', { storage: { level: 'warn', detail: 'd', reason: 'Browser storage is getting full.' } }, 'warn', /getting full/],
  ])('%s turns the level to %s and says so', (_name, patch, level, headline) => {
    const s = bad(patch);
    expect(s.level).toBe(level);
    expect(s.headline).toMatch(headline);
  });

  it('lets the more serious problem win when there are several, but still lists every place the work lives', () => {
    const s = bad({ folder: { status: 'needs-permission', name: 'Novel' }, save: 'error' });
    expect(s.level).toBe('critical');
    expect(s.headline).toMatch(/Saving to this browser failed/);
    expect(s.details).toHaveLength(3);
  });
});
