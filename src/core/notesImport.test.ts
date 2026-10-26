import { describe, expect, it } from 'vitest';
import { exportJSON, importJSON } from './exchange';
import { findEntity } from './links';
import { applyNotesImport, planNotesImport, type NoteFile } from './notesImport';
import { VaultBuilder } from './testkit';
import { parseLinks } from './links';
import type { Vault } from './types';

const f = (path: string, text: string): NoteFile => ({ path, text });
const plan = (files: NoteFile[], vault: Vault = new VaultBuilder().build()) => planNotesImport(vault, files);

describe('planNotesImport: messy input', () => {
  it('reads a BOM and Windows line endings, and takes properties, aliases and tags from the frontmatter', () => {
    const p = plan([f('Characters/Norman.md', '\uFEFF---\r\naliases: [Old Norm, The Grey]\r\ntags: [noble, grim]\r\nrole: wanderer\r\nage: 62\r\nalive: true\r\n---\r\nHe walks.\r\n')]);
    expect(p.notes).toHaveLength(1);
    const n = p.notes[0];
    expect(n).toMatchObject({ name: 'Norman', folder: 'Characters', aliases: ['Old Norm', 'The Grey'], props: { role: 'wanderer', age: 62, alive: true } });
    expect(n.body).toBe('He walks.\n\n#noble #grim\n');
  });

  it('drops a byte-order mark even when there is no frontmatter to hide it behind', () => {
    expect(plan([f('A.md', '\uFEFFHello')]).notes[0].body).toBe('Hello');
  });

  it.each([
    ['a single alias given as a string', 'aliases: Norm', ['Norm']],
    ['aliases mixed with numbers', 'aliases: [Norm, 7]', ['Norm', '7']],
    ['a null alias list', 'aliases:', []],
  ])('accepts %s', (_what, yaml, aliases) => {
    expect(plan([f('N.md', `---\n${yaml}\n---\nx`)]).notes[0].aliases).toEqual(aliases);
  });

  it('keeps a list property as a list, writes a nested one as text, drops empty ones, and survives broken frontmatter', () => {
    const p = plan([
      f('A.md', '---\nrole: [spy, thief]\nhome:\n  city: Ashford\nempty:\nnote: ""\n---\nbody'),
      f('B.md', '---\nthis: is: not: valid: yaml: [\n---\nbody'),
    ]);
    expect(p.notes[0].props).toEqual({ role: ['spy', 'thief'], home: '{"city":"Ashford"}' });
    expect(p.notes[1]).toMatchObject({ name: 'B', props: {} });
  });

  it('does not repeat a tag the note already has, and imports an empty file as an empty page', () => {
    const p = plan([f('A.md', '---\ntags: [noble]\n---\nA #noble person.'), f('Empty.md', '')]);
    expect(p.notes[0].body).toBe('A #noble person.');
    expect(p.notes[1]).toMatchObject({ name: 'Empty', body: '' });
  });

  it('skips non-notes, app folders, names with no letters, and later notes whose name differs only by case', () => {
    const p = plan([
      f('.obsidian/workspace.md', 'x'),
      f('Images/map.png', 'binary'),
      f('Characters/Mira.md', 'one'),
      f('People/mira.md', 'two'),
      f('Notes/…?.md', 'no letters'),
      f('Places/A: B?.md', 'odd but fine'),
    ]);
    expect(p.notes.map((n) => n.name)).toEqual(['Mira', 'A: B?']); // in path order
    expect(p.skipped.map((s) => [s.path, s.reason.split(' ').slice(0, 3).join(' ')])).toEqual([
      ['Images/map.png', 'not a Markdown'],
      ['Notes/…?.md', 'the file name'],
      ['People/mira.md', 'same name as'],
    ]);
  });

  it('names the types the folders suggest, and only the ones the vault does not have', () => {
    const vault = new VaultBuilder().build(); // has the type "Thing"
    vault.entityTypes.p = { id: 'p', name: 'Place', color: '#000', icon: 'map', defaultProps: {} };
    const p = plan([f('Places/Ashford.md', ''), f('Cities/Dover.md', ''), f('Classes/Mage.md', ''), f('Boxes/Tin.md', ''), f('Loose.md', ''), f('Thing/Rock.md', '')], vault);
    expect(p.newTypes).toEqual(['Box', 'City', 'Class', 'Note']);
  });
});

describe('links in imported notes', () => {
  it('shortens folder paths in link targets, and counts resolved and unresolved links so the numbers add up', () => {
    const vault = new VaultBuilder().entity('ashford', {}, 'Ashford').scene('a').build();
    const p = plan(
      [
        f('Characters/Norman.md', 'Lives in [[Places/Ashford|town]], fears [[Characters/Mira]] and [[Nobody]]. See [[Nobody]], [[a]].'),
        f('Characters/Mira.md', 'Knows [[norman]].'),
      ],
      vault,
    );
    expect(p.notes.find((n) => n.name === 'Norman')!.body).toBe('Lives in [[Ashford|town]], fears [[Mira]] and [[Nobody]]. See [[Nobody]], [[a]].');
    expect(p.unresolved).toEqual(['Nobody']);
    const total = p.notes.reduce((n, x) => n + parseLinks(x.body).length, 0);
    expect(total).toBe(6);
    expect(p.resolvedLinks + 2).toBe(total); // the two [[Nobody]] links do not resolve
  });
});

describe('applyNotesImport', () => {
  const files = [
    f('Characters/Norman.md', '---\naliases: [Norm]\nrole: wanderer\n---\nLives in [[Ashford]]. Fears [[Ghost]].'),
    f('Places/Ashford.md', 'A town.'),
  ];

  it('creates entities of the suggested types, with working links, and stubs for the ones that lead nowhere only when asked', () => {
    const vault = new VaultBuilder().entity('other').build();
    const p = plan(files, vault);
    const plain = applyNotesImport(vault, p, { createStubs: false });
    const norman = findEntity(plain, 'norm')!;
    expect(norman.name).toBe('Norman');
    expect(plain.entityTypes[norman.typeId].name).toBe('Character');
    expect(findEntity(plain, 'ghost')).toBeUndefined();
    expect(plain.entities.other).toBe(vault.entities.other);
    const stubbed = applyNotesImport(vault, p, { createStubs: true });
    expect(findEntity(stubbed, 'ghost')).toMatchObject({ name: 'Ghost', note: '' });
  });

  it('importing the same folder again updates the entities instead of duplicating them', () => {
    const once = applyNotesImport(new VaultBuilder().build(), plan(files), { createStubs: true });
    const again = plan(files, once);
    expect(again.notes.every((n) => n.updates !== null)).toBe(true);
    const twice = applyNotesImport(once, again, { createStubs: true });
    expect(Object.keys(twice.entities).sort()).toEqual(Object.keys(once.entities).sort());
    expect(twice.entities[findEntity(twice, 'norman')!.id].aliases).toEqual(['Norm']);
    expect(Object.keys(twice.entityTypes).sort()).toEqual(Object.keys(once.entityTypes).sort());
  });

  it('import, export and import again gives the same vault', () => {
    const imported = applyNotesImport(new VaultBuilder().scene('a').build(), plan(files), { createStubs: true });
    expect(importJSON(exportJSON(imported))).toStrictEqual(imported);
  });
});
