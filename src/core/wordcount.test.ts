import { describe, it, expect } from 'vitest';
import {
  countWords,
  formatCompact,
  formatCount,
  plainText,
  readingMinutes,
  sceneWordCount,
  storyWordCounts,
  WORDS_PER_MINUTE,
} from './wordcount';
import { emptyVault } from './types';
import type { Arc, Chapter, Scene, Vault } from './types';

function scene(id: string, storyId: string, prose: string, chapterId: string | null = null, order = 0): Scene {
  return { id, storyId, chapterId, title: id, prose, momentId: `m_${id}`, order };
}

describe('countWords: plain prose', () => {
  it('is zero for empty, blank and punctuation-only text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
    expect(countWords('... — !! ?? ;;')).toBe(0);
  });

  it('counts space-separated words', () => {
    expect(countWords('The quick brown fox.')).toBe(4);
    expect(countWords('Line one\nline two\r\nline three')).toBe(6);
  });

  it('counts numbers, including separators inside them', () => {
    expect(countWords('There were 1,234 men and 3.5 horses in 1999.')).toBe(9);
    expect(countWords('42')).toBe(1);
    expect(countWords('1st 2nd 3rd')).toBe(3);
  });

  it('keeps hyphenated words and apostrophes as single words', () => {
    expect(countWords('well-known self-aware')).toBe(2);
    expect(countWords("don't can’t it's")).toBe(3);
    expect(countWords('the mother-in-law')).toBe(2);
  });

  it('drops quotes and dashes that are not inside a word', () => {
    expect(countWords("'tis the 'quoted' word")).toBe(4);
    expect(countWords('wait—what "now"')).toBe(3);
  });

  it('handles unicode letters, combining marks and non-Latin scripts', () => {
    expect(countWords('naïve café')).toBe(2);
    expect(countWords('café au lait')).toBe(3);
    expect(countWords('Привет мир')).toBe(2);
    expect(countWords('Ελληνικά και English')).toBe(3);
  });

  it('counts a run of CJK characters without spaces as one word', () => {
    expect(countWords('東京 大阪')).toBe(2);
  });

  it('counts underscore-joined words as separate words', () => {
    expect(countWords('snake_case')).toBe(2);
  });
});

describe('countWords: markdown syntax', () => {
  it('drops heading hashes', () => {
    expect(countWords('# Title\n## Sub heading\n###### Deep')).toBe(4);
    expect(countWords('#hashtag')).toBe(1);
  });

  it('counts setext headings and ignores rules', () => {
    expect(countWords('Title\n=====')).toBe(1);
    expect(countWords('***\n---\n___')).toBe(0);
  });

  it('drops emphasis and strikethrough markers', () => {
    expect(countWords('**bold** and *italic* and ~~gone~~ and ==mark==')).toBe(7);
    expect(countWords('\\*not emphasis\\*')).toBe(2);
  });

  it('drops blockquote markers, nested or not', () => {
    expect(countWords('> quoted line\n> > nested')).toBe(3);
    expect(countWords('>no space')).toBe(2);
  });

  it('drops list bullets, ordered markers and task boxes', () => {
    expect(countWords('- one\n- two\n* three\n+ four')).toBe(4);
    expect(countWords('1. three\n2) four')).toBe(2);
    expect(countWords('- [ ] todo\n- [x] done')).toBe(2);
  });

  it('treats a plain list-looking number inside a sentence as text', () => {
    expect(countWords('It was 3 o’clock.')).toBe(4);
  });

  it('counts callout titles, or the type when there is no title', () => {
    expect(countWords('> [!note] Heads up\n> body text')).toBe(4);
    expect(countWords('> [!warning]\n> body')).toBe(2);
    expect(countWords('> [!tip]- Collapsed title\n> more')).toBe(3);
  });

  it('keeps code content but drops fence lines', () => {
    expect(countWords('```ts\nconst x = 1;\n```')).toBe(3);
    expect(countWords('~~~\nalpha beta\n~~~')).toBe(2);
    expect(countWords('```\n# not a heading\n```')).toBe(3);
  });

  it('does not treat a closing fence with a different marker as closing', () => {
    expect(countWords('````\n```\nin code\n````\nafter')).toBe(3);
  });

  it('a single-line triple-backtick span is inline code, not a fence', () => {
    expect(countWords('```x``` and more')).toBe(3);
  });

  it('keeps inline code content and drops its backticks', () => {
    expect(countWords('Use `npm install` now')).toBe(4);
  });

  it('keeps link text and drops the link target', () => {
    expect(countWords('[click here](https://example.com/a/b)')).toBe(2);
    expect(countWords('[docs](./guide.md) and more')).toBe(3);
  });

  it('drops image sources and alt text', () => {
    expect(countWords('![alt text](pic.png) caption')).toBe(1);
  });

  it('drops footnote references', () => {
    expect(countWords('Claim.[^1] Next')).toBe(2);
  });

  it('reads tables as their cells', () => {
    expect(countWords('| a | b |\n|---|---|\n| c | d |')).toBe(4);
  });

  it('counts each line break as a separator', () => {
    expect(countWords('line one  \nline two')).toBe(4);
  });
});

describe('countWords: URLs', () => {
  it('counts a bare URL as one word', () => {
    expect(countWords('see https://example.com/path?x=1&y=2 today')).toBe(3);
    expect(countWords('Go to www.example.org.')).toBe(3);
  });

  it('counts an autolink as one word', () => {
    expect(countWords('<https://a.b/c>')).toBe(1);
  });

  it('does not swallow a closing parenthesis after a URL', () => {
    expect(countWords('(see https://example.com).')).toBe(2);
  });
});

describe('countWords: wikilinks', () => {
  it('counts the alias when there is one', () => {
    expect(countWords('[[Mary|the baker]] waved.')).toBe(3);
    expect(countWords('[[Old|New]]')).toBe(1);
  });

  it('counts the target when there is no alias', () => {
    expect(countWords('[[Norman]] met [[Old Mary]].')).toBe(4);
  });

  it('counts the heading with the target, as the reader sees it', () => {
    expect(countWords('[[Norman#Bio]]')).toBe(2);
  });

  it('drops the time part of a link', () => {
    expect(countWords('[[Norman@latest]] and [[Keep@before:The Siege]]')).toBe(3);
  });

  it('counts embeds as their link text', () => {
    expect(countWords('![[Map]]')).toBe(1);
  });

  it('keeps wikilinks inside code as written', () => {
    expect(countWords('`[[Norman]]` ok')).toBe(2);
  });

  it('ignores an empty or unclosed link', () => {
    expect(countWords('[[]] and [[ open')).toBe(2);
  });

  it('does not count a link adjacent to words as separate words', () => {
    expect(countWords('pre[[Mid]]post')).toBe(1);
  });
});

describe('countWords: tags', () => {
  it('counts tag names', () => {
    expect(countWords('#magic and #sword/long')).toBe(4);
  });
});

describe('countWords: author notes and frontmatter', () => {
  it('removes inline percent notes', () => {
    expect(countWords('Visible %% hidden note words here %% text')).toBe(2);
  });

  it('removes html comment notes', () => {
    expect(countWords('a <!-- secret words --> b')).toBe(2);
  });

  it('removes a note spanning whole lines, without leaving blank lines', () => {
    expect(countWords('%%\nwriter only\nthree lines\n%%\nKept line')).toBe(2);
    expect(plainText('%%\nwriter only\n%%\nKept line')).toBe('Kept line');
  });

  it('keeps note-like text inside code', () => {
    expect(countWords('`%% not a note %%` after')).toBe(4);
  });

  it('drops a leading frontmatter block', () => {
    expect(countWords('---\ntitle: X\ntags: [a, b]\n---\nBody words here')).toBe(3);
  });

  it('drops an empty frontmatter block', () => {
    expect(countWords('---\n---\nText')).toBe(1);
  });

  it('does not treat a later rule as frontmatter', () => {
    expect(countWords('Opening words\n\n---\n\nmore words')).toBe(4);
  });
});

describe('countWords: // line notes', () => {
  it('leaves a trailing // note out of the count', () => {
    expect(countWords('Visible words // hidden note words\nnext line')).toBe(4);
  });

  it('leaves a whole-line // note out, without a blank line left behind', () => {
    expect(plainText('// writer only\nKept line')).toBe('Kept line');
  });

  it('keeps a // inside code', () => {
    expect(countWords('`// not a note` after')).toBe(4);
  });

  it('counts a URL as one word and does not treat it as a note', () => {
    expect(countWords('See https://example.com now')).toBe(3);
  });
});

describe('plainText', () => {
  it('returns the visible text with structural markup removed', () => {
    expect(plainText('## Head\n\n**Bold** [[Mary|Her]] and `code`.')).toBe('Head\n\n**Bold** Her and code.');
  });

  it('removes the frontmatter and the note but keeps the surrounding lines', () => {
    expect(plainText('---\na: 1\n---\nOne %% two %%\nthree')).toBe('One\nthree');
  });

  it('removes a link target and an image source', () => {
    expect(plainText('[site](https://x.y) ![pic](a.png)')).toBe('site');
  });
});

describe('readingMinutes', () => {
  it('is 0 for no words', () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(-5)).toBe(0);
    expect(readingMinutes(Number.NaN)).toBe(0);
  });

  it('is at least 1 minute once there is any text', () => {
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(WORDS_PER_MINUTE)).toBe(1);
  });

  it('rounds up at about 230 words per minute', () => {
    expect(readingMinutes(WORDS_PER_MINUTE + 1)).toBe(2);
    expect(readingMinutes(1234)).toBe(6);
  });
});

describe('formatting', () => {
  it('formatCount groups thousands', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('formatCompact shortens large numbers', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(1000)).toBe('1k');
    expect(formatCompact(1234)).toBe('1.2k');
    expect(formatCompact(1250)).toBe('1.3k');
    expect(formatCompact(12345)).toBe('12k');
    expect(formatCompact(1_500_000)).toBe('1.5M');
    expect(formatCompact(2_000_000)).toBe('2M');
  });
});

describe('sceneWordCount cache', () => {
  it('recounts when the prose of the same scene changes', () => {
    expect(sceneWordCount(scene('cache-b', 'st', 'one two'))).toBe(2);
    expect(sceneWordCount(scene('cache-b', 'st', 'one two three four'))).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Story totals
// ---------------------------------------------------------------------------

function vaultWith(parts: {
  arcs?: Arc[];
  chapters?: Chapter[];
  scenes?: Scene[];
}): Vault {
  const v = emptyVault();
  for (const a of parts.arcs ?? []) v.arcs[a.id] = a;
  for (const c of parts.chapters ?? []) v.chapters[c.id] = c;
  for (const s of parts.scenes ?? []) v.scenes[s.id] = s;
  return v;
}

function sum(m: Map<unknown, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

describe('storyWordCounts', () => {
  it('is zero for an empty story', () => {
    const v = vaultWith({ chapters: [{ id: 'c1', storyId: 'st', title: 'One', order: 0 }] });
    const wc = storyWordCounts(v, 'st');
    expect(wc.total).toBe(0);
    expect(wc.byChapter.get('c1')).toBe(0);
    expect(wc.byChapter.has(null)).toBe(false);
    expect(wc.byArc.size).toBe(0);
    expect(wc.byScene.size).toBe(0);
  });

  it('totals scenes, chapters and scenes per story', () => {
    const v = vaultWith({
      chapters: [
        { id: 'c1', storyId: 'st', title: 'One', order: 0 },
        { id: 'c2', storyId: 'st', title: 'Two', order: 1 },
      ],
      scenes: [
        scene('s1', 'st', 'one two three', 'c1', 0),
        scene('s2', 'st', 'four five', 'c1', 1),
        scene('s3', 'st', 'six seven eight nine', 'c2', 2),
      ],
    });
    const wc = storyWordCounts(v, 'st');
    expect(wc.total).toBe(9);
    expect(wc.byChapter.get('c1')).toBe(5);
    expect(wc.byChapter.get('c2')).toBe(4);
    expect(wc.byScene.get('s1')).toBe(3);
    expect(wc.byScene.get('s3')).toBe(4);
    expect(wc.byChapter.has(null)).toBe(false);
  });

  it('excludes other stories', () => {
    const v = vaultWith({
      chapters: [
        { id: 'c1', storyId: 'st', title: 'One', order: 0 },
        { id: 'x1', storyId: 'other', title: 'Foreign', order: 0 },
      ],
      scenes: [scene('s1', 'st', 'a b c', 'c1'), scene('s9', 'other', 'lots of words in the other story', 'x1')],
    });
    const wc = storyWordCounts(v, 'st');
    expect(wc.total).toBe(3);
    expect(wc.byScene.has('s9')).toBe(false);
    expect(wc.byChapter.has('x1')).toBe(false);
  });

  it('puts scenes without a chapter under the null chapter key', () => {
    const v = vaultWith({
      chapters: [{ id: 'c1', storyId: 'st', title: 'One', order: 0 }],
      scenes: [scene('s1', 'st', 'a b', 'c1'), scene('s2', 'st', 'c d e', null, 1)],
    });
    const wc = storyWordCounts(v, 'st');
    expect(wc.byChapter.get(null)).toBe(3);
    expect(wc.byChapter.get('c1')).toBe(2);
  });

  it('treats a scene pointing at a chapter of another story as loose', () => {
    const v = vaultWith({
      chapters: [
        { id: 'c1', storyId: 'st', title: 'One', order: 0 },
        { id: 'x1', storyId: 'other', title: 'Foreign', order: 0 },
      ],
      scenes: [scene('s1', 'st', 'a b', 'x1')],
    });
    const wc = storyWordCounts(v, 'st');
    expect(wc.byChapter.get(null)).toBe(2);
    expect(wc.byChapter.get('c1')).toBe(0);
  });

  it('groups chapter totals by arc, with unarced chapters under null', () => {
    const v = vaultWith({
      arcs: [
        { id: 'a1', storyId: 'st', title: 'Arc', order: 0 },
        { id: 'a2', storyId: 'st', title: 'Empty arc', order: 1 },
      ],
      chapters: [
        { id: 'c1', storyId: 'st', title: 'One', order: 0, arcId: 'a1' },
        { id: 'c2', storyId: 'st', title: 'Two', order: 1 },
      ],
      scenes: [scene('s1', 'st', 'a b c', 'c1'), scene('s2', 'st', 'd e', 'c2', 1), scene('s3', 'st', 'f', null, 2)],
    });
    const wc = storyWordCounts(v, 'st');
    expect(wc.byArc.get('a1')).toBe(3);
    expect(wc.byArc.get('a2')).toBe(0);
    expect(wc.byArc.get(null)).toBe(3);
  });

  it('treats a chapter whose arc belongs to another story as unarced', () => {
    const v = vaultWith({
      arcs: [{ id: 'ax', storyId: 'other', title: 'Foreign arc', order: 0 }],
      chapters: [{ id: 'c1', storyId: 'st', title: 'One', order: 0, arcId: 'ax' }],
      scenes: [scene('s1', 'st', 'a b', 'c1')],
    });
    const wc = storyWordCounts(v, 'st');
    expect(wc.byArc.has('ax')).toBe(false);
    expect(wc.byArc.get(null)).toBe(2);
  });

  it('keeps the arc, chapter and scene totals in step with the story total', () => {
    const v = vaultWith({
      arcs: [{ id: 'a1', storyId: 'st', title: 'Arc', order: 0 }],
      chapters: [
        { id: 'c1', storyId: 'st', title: 'One', order: 0, arcId: 'a1' },
        { id: 'c2', storyId: 'st', title: 'Two', order: 1 },
      ],
      scenes: [
        scene('s1', 'st', 'one two', 'c1', 0),
        scene('s2', 'st', 'three', 'c2', 1),
        scene('s3', 'st', 'four five six', null, 2),
      ],
    });
    const wc = storyWordCounts(v, 'st');
    expect(wc.total).toBe(6);
    expect(sum(wc.byChapter)).toBe(wc.total);
    expect(sum(wc.byArc)).toBe(wc.total);
    expect(sum(wc.byScene)).toBe(wc.total);
  });

  it('reflects prose edits and drops deleted scenes from the totals', () => {
    const base = vaultWith({
      chapters: [{ id: 'c1', storyId: 'st', title: 'One', order: 0 }],
      scenes: [scene('s1', 'st', 'one two', 'c1'), scene('s2', 'st', 'three four five', 'c1', 1)],
    });
    expect(storyWordCounts(base, 'st').total).toBe(5);

    const edited = vaultWith({
      chapters: [{ id: 'c1', storyId: 'st', title: 'One', order: 0 }],
      scenes: [scene('s1', 'st', 'one two six seven', 'c1'), scene('s2', 'st', 'three four five', 'c1', 1)],
    });
    expect(storyWordCounts(edited, 'st').total).toBe(7);

    const deleted = vaultWith({
      chapters: [{ id: 'c1', storyId: 'st', title: 'One', order: 0 }],
      scenes: [scene('s2', 'st', 'three four five', 'c1', 1)],
    });
    const wc = storyWordCounts(deleted, 'st');
    expect(wc.total).toBe(3);
    expect(wc.byScene.has('s1')).toBe(false);
  });
});

describe('countWords: scripts written without spaces', () => {
  // Exact counts depend on the runtime's dictionary data, so these pin what must hold, not the dictionary's choices.
  it.each([
    ['Chinese', '我今天去了商店买了一些苹果'],
    ['Japanese', '私は猫が好きです'],
    ['Thai', 'ฉันรักภาษาไทย'],
  ])('%s: a sentence is several words, not one (and never more than its letters)', (_script, sentence) => {
    const n = countWords(sentence);
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThanOrEqual([...sentence].length);
  });

  it('counts the words around a Chinese phrase in mixed text', () => {
    expect(countWords('Hello 世界 world')).toBeGreaterThanOrEqual(3);
  });

  it('paragraphs add up: counting two paragraphs together equals counting each', () => {
    const a = '我喜欢苹果，你喜欢香蕉。';
    const b = '今天天气很好。';
    expect(countWords(`${a}\n\n${b}`)).toBe(countWords(a) + countWords(b));
  });
});
