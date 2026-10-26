import { describe, it, expect } from 'vitest';
import { buildManuscript, toHTML, toMarkdown, toPlainText, manuscriptFileName } from './manuscript';
import type { ManuscriptOptions } from './manuscript';
import { emptyVault } from './types';
import type { Arc, Chapter, Entity, Scene, Vault } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseVault(): Vault {
  const v = emptyVault();
  v.stories.s1 = { id: 's1', name: 'The Long Night', color: '#000', order: 0 };
  v.stories.s2 = { id: 's2', name: 'Other Story', color: '#000', order: 1 };
  return v;
}

function chapter(v: Vault, c: Partial<Chapter> & { id: string; order: number }): void {
  v.chapters[c.id] = { storyId: 's1', title: `Title ${c.id}`, ...c };
}

function scene(v: Vault, s: Partial<Scene> & { id: string; order: number }): void {
  v.scenes[s.id] = {
    storyId: 's1',
    chapterId: null,
    title: s.id,
    prose: '',
    momentId: `m_${s.id}`,
    ...s,
  };
}

function opts(over: Partial<ManuscriptOptions> = {}): ManuscriptOptions {
  return {
    storyId: 's1',
    chapterIds: null,
    sceneSeparator: 'titles',
    chapterHeadings: true,
    keepNotes: false,
    ...over,
  };
}

/** Two chapters (inserted out of order), one scene without a chapter, one scene in another story. */
function bookVault(): Vault {
  const v = baseVault();
  v.arcs.a1 = { id: 'a1', storyId: 's1', title: 'Embers', order: 0 } satisfies Arc;
  chapter(v, { id: 'c2', order: 1, title: 'Chapter Two', arcId: 'a1' });
  chapter(v, { id: 'c1', order: 0, title: 'Chapter One' });
  scene(v, { id: 'sB', order: 2, chapterId: 'c2', title: 'Second', prose: 'Second scene text.' });
  scene(v, { id: 'sA', order: 1, chapterId: 'c1', title: 'First', prose: 'First scene text.' });
  scene(v, { id: 'sC', order: 0, chapterId: 'c1', title: 'Opening', prose: 'Opening text.' });
  scene(v, { id: 'sLoose', order: 3, chapterId: null, title: 'Loose', prose: 'Loose text.' });
  scene(v, { id: 'sOther', order: 0, storyId: 's2', chapterId: null, title: 'Elsewhere', prose: 'Nope.' });
  return v;
}

function entity(v: Vault, e: Partial<Entity> & { id: string; name: string }): void {
  v.entities[e.id] = { typeId: 'char', aliases: [], note: '', props: {}, ...e } as Entity;
}

// ---------------------------------------------------------------------------
// Ordering and selection
// ---------------------------------------------------------------------------

describe('buildManuscript ordering', () => {
  it('orders chapters by order and scenes by reading order, unchaptered scenes last', () => {
    const m = buildManuscript(bookVault(), opts());
    expect(m.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two', null]);
    expect(m.chapters[0].scenes.map((s) => s.id)).toEqual(['sC', 'sA']);
    expect(m.chapters[1].scenes.map((s) => s.id)).toEqual(['sB']);
    expect(m.chapters[2].scenes.map((s) => s.id)).toEqual(['sLoose']);
  });

  it('never includes scenes of other stories', () => {
    const m = buildManuscript(bookVault(), opts());
    const ids = m.chapters.flatMap((c) => c.scenes.map((s) => s.id));
    expect(ids).not.toContain('sOther');
  });

  it('keeps chapter order when a subset is given in another order', () => {
    const m = buildManuscript(bookVault(), opts({ chapterIds: ['c2', 'c1'] }));
    expect(m.chapters.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('includes only the requested chapters', () => {
    const m = buildManuscript(bookVault(), opts({ chapterIds: ['c2'] }));
    expect(m.chapters.map((c) => c.title)).toEqual(['Chapter Two']);
    expect(m.chapters[0].scenes.map((s) => s.id)).toEqual(['sB']);
  });

  it('leaves unchaptered scenes out of a subset unless asked for', () => {
    const v = bookVault();
    expect(buildManuscript(v, opts({ chapterIds: ['c1'] })).chapters.map((c) => c.id)).toEqual(['c1']);
    const withLoose = buildManuscript(v, opts({ chapterIds: ['c1'], includeUnchaptered: true }));
    expect(withLoose.chapters.map((c) => c.id)).toEqual(['c1', null]);
  });

  it('drops the unchaptered group when includeUnchaptered is false for the whole story', () => {
    const m = buildManuscript(bookVault(), opts({ includeUnchaptered: false }));
    expect(m.chapters.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('reports the arc title of a chapter', () => {
    const m = buildManuscript(bookVault(), opts());
    expect(m.chapters[1].arcTitle).toBe('Embers');
    expect(m.chapters[0].arcTitle).toBeNull();
  });

  it('defaults the title to the story name and trims the author', () => {
    const m = buildManuscript(bookVault(), opts({ author: '  Ada  ' }));
    expect(m.title).toBe('The Long Night');
    expect(m.author).toBe('Ada');
    const titled = buildManuscript(bookVault(), opts({ title: 'Custom' }));
    expect(titled.title).toBe('Custom');
    expect(titled.author).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scene text processing
// ---------------------------------------------------------------------------

describe('scene text', () => {
  it('replaces links and embeds with their display text', () => {
    const v = baseVault();
    entity(v, { id: 'e1', name: 'Norman' });
    chapter(v, { id: 'c1', order: 0 });
    scene(v, { id: 'sDawn', order: 0, title: 'Dawn', chapterId: 'c1', prose: '' });
    scene(v, {
      id: 'sMain',
      order: 1,
      chapterId: 'c1',
      prose:
        'Met [[Norman]] and [[norman|the old man]] at [[Norman#Bio@latest]].\n\n' +
        '![[Norman]] saw [[Dawn@before:Norman]] and [[Ghost]]. Keep #magic and `[[Norman]]`.',
    });
    const text = buildManuscript(v, opts()).chapters[0].scenes[1].text;
    expect(text).toBe(
      'Met Norman and the old man at Norman.\n\n' +
        'Norman saw Dawn and Ghost. Keep #magic and `[[Norman]]`.',
    );
  });

  it('drops YAML frontmatter', () => {
    const v = baseVault();
    chapter(v, { id: 'c1', order: 0 });
    scene(v, { id: 's1', order: 0, chapterId: 'c1', prose: '---\ntitle: Secret\nstatus: draft\n---\nThe real text.' });
    expect(buildManuscript(v, opts()).chapters[0].scenes[0].text).toBe('The real text.');
  });

  it('strips author notes by default and keeps them when asked', () => {
    const v = baseVault();
    chapter(v, { id: 'c1', order: 0 });
    scene(v, {
      id: 's1',
      order: 0,
      chapterId: 'c1',
      prose: 'Before. %% a private note %%\n\n<!-- todo: cut this -->\n\nAfter.',
    });
    const stripped = buildManuscript(v, opts()).chapters[0].scenes[0].text;
    expect(stripped).not.toContain('private');
    expect(stripped).not.toContain('todo');
    expect(stripped).toContain('Before.');
    expect(stripped).toContain('After.');

    const kept = buildManuscript(v, opts({ keepNotes: true }));
    expect(kept.chapters[0].scenes[0].text).toContain('%% a private note %%');
    expect(toMarkdown(kept, opts({ keepNotes: true }))).toContain('<!-- todo: cut this -->');
    expect(toPlainText(kept, opts({ keepNotes: true }))).toContain('[Note: a private note]');
    expect(toPlainText(kept, opts({ keepNotes: true }))).toContain('[Note: todo: cut this]');
    expect(toHTML(kept, opts({ keepNotes: true }))).toContain('<aside class="author-note">a private note</aside>');
    expect(toPlainText(buildManuscript(v, opts()), opts())).not.toContain('private');
  });

  it('strips // notes by default and keeps them as notes when asked', () => {
    const v = baseVault();
    chapter(v, { id: 'c1', order: 0 });
    scene(v, {
      id: 's1',
      order: 0,
      chapterId: 'c1',
      prose: 'Before. // a private note\n// whole line secret\nAfter. See https://example.com.',
    });
    expect(buildManuscript(v, opts()).chapters[0].scenes[0].text).toBe('Before.\nAfter. See https://example.com.');

    const kept = buildManuscript(v, opts({ keepNotes: true }));
    expect(toPlainText(kept, opts({ keepNotes: true }))).toContain('[Note: a private note]');
    expect(toPlainText(kept, opts({ keepNotes: true }))).toContain('[Note: whole line secret]');
    expect(toPlainText(kept, opts({ keepNotes: true }))).toContain('https://example.com');
  });

  it('counts words of the final text, excluding headings', () => {
    const v = baseVault();
    chapter(v, { id: 'c1', order: 0 });
    scene(v, { id: 's1', order: 0, chapterId: 'c1', prose: 'One two three.' });
    scene(v, { id: 's2', order: 1, chapterId: 'c1', prose: '## Heading\n\nfour five' });
    expect(buildManuscript(v, opts()).wordCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

describe('output formats', () => {
  const o = opts({ author: 'Ada', title: 'My Book' });
  const v = bookVault();

  it('renders Markdown with title, author, chapter and scene headings', () => {
    const md = toMarkdown(buildManuscript(v, o), o);
    expect(md.startsWith('# My Book\n\n*by Ada*\n')).toBe(true);
    expect(md).toContain('## Chapter One');
    expect(md).toContain('### Opening');
    expect(md).toContain('Opening text.');
    expect(md.indexOf('Opening text.')).toBeLessThan(md.indexOf('First scene text.'));
  });

  it('renders plain text without markdown syntax and with underlined headings', () => {
    const txt = toPlainText(buildManuscript(v, o), o);
    expect(txt.startsWith('MY BOOK\n=======\n\nby Ada')).toBe(true);
    expect(txt).toContain('CHAPTER ONE\n-----------');
    expect(txt).toContain('Opening\n\nOpening text.');
    expect(txt).not.toContain('#');
  });

  it('renders a standalone HTML document with the expected structure', () => {
    const html = toHTML(buildManuscript(v, o), o);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>My Book</title>');
    expect(html).toContain('<h2>Chapter One</h2>');
    expect(html).toContain('<h3 class="scene-title">Opening</h3>');
    expect(html).toContain('break-before: page');
    expect(html).not.toMatch(/<link\b|src="http/);
  });

  it('uses scene breaks between scenes of a chapter only when asked', () => {
    const one = opts({ chapterIds: ['c1'], sceneSeparator: 'breaks' });
    const m = buildManuscript(v, one);
    expect(toMarkdown(m, one).split('* * *').length - 1).toBe(1);
    expect(toPlainText(m, one).split('* * *').length - 1).toBe(1);
    expect(toHTML(m, one).split('class="ornament"').length - 1).toBe(1);

    const none = opts({ chapterIds: ['c1'], sceneSeparator: 'none' });
    const md = toMarkdown(buildManuscript(v, none), none);
    expect(md).not.toContain('* * *');
    expect(md).not.toContain('### ');
  });

  it('omits chapter headings when they are turned off', () => {
    const plain = opts({ chapterHeadings: false });
    expect(toMarkdown(buildManuscript(v, plain), plain)).not.toMatch(/^## /m);
    expect(toHTML(buildManuscript(v, plain), plain)).not.toContain('<h2>');
  });

  it('strips markdown syntax in plain text but keeps the paragraphs', () => {
    const w = baseVault();
    chapter(w, { id: 'c1', order: 0 });
    scene(w, {
      id: 's1',
      order: 0,
      chapterId: 'c1',
      prose: '**Bold** and *em* and [a link](http://x.test) and `code`.\n\n# Not a heading\n\n> quoted',
    });
    const txt = toPlainText(buildManuscript(w, opts()), opts());
    expect(txt).toContain('Bold and em and a link and code.');
    expect(txt).toContain('Not a heading');
    expect(txt).toContain('quoted');
    expect(txt).not.toContain('**');
    expect(txt).not.toContain('[a link]');
    expect(txt).not.toContain('#');
  });

  it('escapes script tags in prose in HTML', () => {
    const w = baseVault();
    chapter(w, { id: 'c1', order: 0 });
    scene(w, { id: 's1', order: 0, chapterId: 'c1', prose: "Hello <script>alert('x')</script> there." });
    const html = toHTML(buildManuscript(w, opts()), opts());
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

describe('manuscriptFileName', () => {
  function named(title: string): ReturnType<typeof buildManuscript> {
    return { title, chapters: [], wordCount: 0 };
  }

  it('removes characters that are not allowed in file names', () => {
    expect(manuscriptFileName(named('A/B: C*?'), 'md')).toBe('AB C.md');
  });

  it('falls back to a default name when nothing usable is left', () => {
    expect(manuscriptFileName(named('...'), 'txt')).toBe('manuscript.txt');
    expect(manuscriptFileName(named('   '), 'html')).toBe('manuscript.html');
  });

  it('avoids reserved Windows device names', () => {
    expect(manuscriptFileName(named('CON'), 'html')).toBe('_CON.html');
  });
});
