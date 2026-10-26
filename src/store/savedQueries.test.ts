import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import { isQueryPage, queryTextOf, saveQuery, savedQueries } from './savedQueries';

describe('saved queries', () => {
  it('keeps the query as the page’s “where” line, so it can be edited like any text, and finds it again', () => {
    const v = new VaultBuilder().entity('norman').build();
    const saved = saveQuery(v, 'Dead people', 'type=Character status=dead at latest');
    const page = saved.vault.entities[saved.id];
    expect(page.note).toBe('where type=Character status=dead at latest\n');
    expect(queryTextOf(page.note)).toBe('type=Character status=dead at latest');
    expect(isQueryPage(saved.vault, saved.id)).toBe(true);
    expect(isQueryPage(saved.vault, 'norman')).toBe(false);
    expect(v.entityTypes.query).toBeUndefined(); // the original vault is not changed
  });

  it('adds the Query type once, numbers a name that is taken, and ignores notes around the where line', () => {
    const v = new VaultBuilder().build();
    const one = saveQuery(v, 'Alive', 'status=alive');
    const two = saveQuery(one.vault, 'alive', 'status=alive at latest');
    expect(Object.values(two.vault.entityTypes).filter((t) => t.name === 'Query')).toHaveLength(1);
    expect(savedQueries(two.vault).map((e) => e.name)).toEqual(['Alive', 'alive 2']);
    expect(queryTextOf('Who is still around?\n\nWHERE  status=alive  \nmore notes')).toBe('status=alive');
    expect(queryTextOf('nothing here, somewhere else')).toBeNull();
  });
});
