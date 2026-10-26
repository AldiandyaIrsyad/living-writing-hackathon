import { describe, expect, it } from 'vitest';
import { parseRelationQuery, runRelationQuery } from './relationQuery';
import { addParent, baseRelations } from './relations';
import { VaultBuilder } from './testkit';

describe('parseRelationQuery', () => {
  it.each([
    ['children of Ashford', 'children', 'Ashford'],
    ['children Ashford', 'children', 'Ashford'],
    ['Kids of ashford', 'children', 'ashford'],
    ['parent of Mira', 'parents', 'Mira'],
    ['siblings of Bob', 'siblings', 'Bob'],
    ['under Asia', 'descendants', 'Asia'],
    ['above Harbor', 'ancestors', 'Harbor'],
  ] as const)('reads "%s"', (raw, kind, subject) => {
    expect(parseRelationQuery(raw)).toEqual({ kind, subject, tags: [] });
  });

  it('pulls #tags out of the subject, wherever they are typed', () => {
    expect(parseRelationQuery('under Asia #city')).toEqual({ kind: 'descendants', subject: 'Asia', tags: ['city'] });
    expect(parseRelationQuery('children of #city #port/big Ashford')).toEqual({ kind: 'children', subject: 'Ashford', tags: ['city', 'port/big'] });
  });

  it('is still a query while the name is being typed, with an empty subject', () => {
    expect(parseRelationQuery('children')).toEqual({ kind: 'children', subject: '', tags: [] });
    expect(parseRelationQuery('children of')).toEqual({ kind: 'children', subject: '', tags: [] });
  });

  it('leaves everything else to the ordinary search', () => {
    expect(parseRelationQuery('Ashford')).toBeNull();
    expect(parseRelationQuery('childhood friend')).toBeNull();
    expect(parseRelationQuery('')).toBeNull();
    expect(parseRelationQuery('@children of')).toBeNull();
  });
});

describe('runRelationQuery', () => {
  const world = () => {
    const b = new VaultBuilder();
    for (const id of ['asia', 'ashford', 'harbor', 'mira']) b.entity(id, {}, id);
    b.v.entities.ashford.note = 'A big #city on the coast.';
    b.v.entities.harbor.note = 'A #district of Ashford.';
    let v = b.build();
    v = addParent(v, 'ashford', 'asia', 'base');
    v = addParent(v, 'harbor', 'ashford', 'base');
    return v;
  };

  it('answers each kind from the relations, and narrows by tag', () => {
    const v = world();
    const rel = baseRelations(v);
    const q = (raw: string) => runRelationQuery(v, rel, parseRelationQuery(raw)!, 'asia');
    expect(q('children asia')).toEqual(['ashford']);
    expect(q('under asia')).toEqual(['ashford', 'harbor']);
    expect(q('under asia #city')).toEqual(['ashford']);
    expect(q('under asia #city #district')).toEqual([]);
  });
});
