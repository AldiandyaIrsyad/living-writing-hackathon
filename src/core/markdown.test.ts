import { describe, it, expect } from 'vitest';
import { renderMarkdown, splitFrontmatter } from './markdown';
import type { RenderContext, LinkResolution } from './markdown';
import { findEntity, findScene } from './links';
import type { ParsedLink } from './links';
import { emptyVault } from './types';
import type { Vault, Entity, Scene } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildVault(): Vault {
  const v = emptyVault();
  const norman: Entity = {
    id: 'ent_norman',
    typeId: 'type_char',
    name: 'Norman',
    aliases: ['the old man'],
    note: '',
    props: {},
  };
  const siege: Scene = {
    id: 'sc_siege',
    storyId: 'story_main',
    chapterId: null,
    title: 'The Siege',
    prose: '',
    momentId: 'm_siege',
    order: 0,
  };
  v.entities[norman.id] = norman;
  v.scenes[siege.id] = siege;
  return v;
}

const vault = buildVault();

function resolveLink(link: ParsedLink): LinkResolution {
  const entity = findEntity(vault, link.target);
  if (entity) return { resolved: true, kind: 'entity', id: entity.id, display: entity.name };
  const scene = findScene(vault, link.target);
  if (scene) return { resolved: true, kind: 'scene', id: scene.id, display: scene.title };
  return { resolved: false };
}

/** Context with no embed support. */
const plainCtx: RenderContext = { resolveLink };

function html(text: string, ctx: RenderContext = plainCtx): string {
  return renderMarkdown(text, ctx).html;
}

/** Context whose embeds render the target note recursively, like the app does. */
function recursiveCtx(depth = 0): RenderContext {
  return {
    resolveLink,
    depth,
    renderEmbed: (link, d) => renderMarkdown(`![[${link.target}]]`, recursiveCtx(d)).html,
  };
}

function countMatches(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

// ---------------------------------------------------------------------------
// splitFrontmatter
// ---------------------------------------------------------------------------

describe('splitFrontmatter', () => {
  it('returns null data and the full body when there is no frontmatter', () => {
    expect(splitFrontmatter('# Title\n\ntext')).toEqual({ data: null, body: '# Title\n\ntext' });
  });

  it('parses YAML frontmatter and strips it from the body', () => {
    const r = splitFrontmatter('---\ntitle: Norman\nalive: true\ncount: 3\n---\n# Body');
    expect(r.data).toEqual({ title: 'Norman', alive: true, count: 3 });
    expect(r.body).toBe('# Body');
  });

  it('accepts CRLF line endings', () => {
    const r = splitFrontmatter('---\r\ntitle: Norman\r\n---\r\nbody');
    expect(r.data).toEqual({ title: 'Norman' });
    expect(r.body).toBe('body');
  });

  it('parses arrays and nested values', () => {
    const r = splitFrontmatter('---\ntags: [a, b]\nmeta:\n  x: 1\n---\n');
    expect(r.data).toEqual({ tags: ['a', 'b'], meta: { x: 1 } });
    expect(r.body).toBe('');
  });

  it('treats an empty block as an empty object', () => {
    expect(splitFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body' });
  });

  it('does not let an empty block swallow a later --- line', () => {
    expect(splitFrontmatter('---\n---\nbody\n---\nx').body).toBe('body\n---\nx');
  });

  it('gives null data for invalid YAML but still strips the block', () => {
    const r = splitFrontmatter('---\na: [1\n---\nbody');
    expect(r.data).toBeNull();
    expect(r.body).toBe('body');
  });

  it('gives null data for YAML that is not a mapping but still strips the block', () => {
    const r = splitFrontmatter('---\n- a\n- b\n---\nbody');
    expect(r.data).toBeNull();
    expect(r.body).toBe('body');
  });

  it('only treats a leading block as frontmatter', () => {
    const text = 'Intro\n---\nkey: value\n---\n';
    expect(splitFrontmatter(text)).toEqual({ data: null, body: text });
  });
});

// ---------------------------------------------------------------------------
// Frontmatter rendering
// ---------------------------------------------------------------------------

describe('renderMarkdown frontmatter', () => {
  it('renders a table of keys at the top of the html', () => {
    const r = renderMarkdown('---\ntitle: Norman\ntags: [a, b]\nalive: true\n---\n# Body', plainCtx);
    expect(r.frontmatter).toEqual({ title: 'Norman', tags: ['a', 'b'], alive: true });
    expect(r.html.startsWith('<table class="frontmatter">')).toBe(true);
    expect(r.html).toContain('<tr><th>title</th><td>Norman</td></tr>');
    expect(r.html).toContain('<tr><th>tags</th><td>a, b</td></tr>');
    expect(r.html).toContain('<tr><th>alive</th><td>true</td></tr>');
    expect(r.html).toContain('<h1>Body</h1>');
    expect(r.html).not.toContain('---');
  });

  it('escapes frontmatter values', () => {
    const r = renderMarkdown('---\nnote: "<b>x</b> & y"\n---\n', plainCtx);
    expect(r.html).toContain('<td>&lt;b&gt;x&lt;/b&gt; &amp; y</td>');
  });

  it('returns null frontmatter and renders the body for invalid YAML', () => {
    const r = renderMarkdown('---\na: [1\n---\nbody text', plainCtx);
    expect(r.frontmatter).toBeNull();
    expect(r.html).toBe('<p>body text</p>\n');
  });

  it('returns null frontmatter when there is none', () => {
    expect(renderMarkdown('plain', plainCtx).frontmatter).toBeNull();
  });

  it('renders no table for an empty frontmatter block', () => {
    const r = renderMarkdown('---\n---\nbody', plainCtx);
    expect(r.frontmatter).toEqual({});
    expect(r.html).not.toContain('frontmatter');
  });
});

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------

describe('wikilinks', () => {
  it('renders a resolved entity link with data attributes', () => {
    expect(html('Hi [[norman]].')).toBe(
      '<p>Hi <a class="wikilink" href="#" data-link-raw="[[norman]]" data-link-target="norman" data-kind="entity" data-id="ent_norman">Norman</a>.</p>\n',
    );
  });

  it('uses the alias as display text', () => {
    expect(html('[[norman|the old man]]')).toContain(
      'data-link-raw="[[norman|the old man]]" data-link-target="norman" data-kind="entity" data-id="ent_norman">the old man</a>',
    );
  });

  it('records the time part in data-link-time', () => {
    const out = html('[[norman@before:The Siege]]');
    expect(out).toContain('data-link-time="before:The Siege"');
    expect(out).toContain('data-link-target="norman"');
  });

  it('omits data-link-time when there is no @ part', () => {
    expect(html('[[norman]]')).not.toContain('data-link-time');
  });

  it('records @latest in data-link-time', () => {
    expect(html('[[norman@latest]]')).toContain('data-link-time="latest"');
  });

  it('renders an unresolved link with class unresolved and no kind or id', () => {
    const out = html('[[ghost]]');
    expect(out).toBe(
      '<p><a class="wikilink unresolved" href="#" data-link-raw="[[ghost]]" data-link-target="ghost">ghost</a></p>\n',
    );
    expect(out).not.toContain('data-kind');
    expect(out).not.toContain('data-id');
  });

  it('shows target#heading for an unresolved link with a heading and no alias', () => {
    expect(html('[[ghost#Bio]]')).toContain('>ghost#Bio</a>');
  });

  it('resolves a link to a scene by title', () => {
    const out = html('[[The Siege]]');
    expect(out).toContain('data-kind="scene"');
    expect(out).toContain('>The Siege</a>');
  });

  it('works inside lists, headings, blockquotes and emphasis', () => {
    const out = html('# [[norman]]\n\n- item [[norman]]\n\n> quote [[ghost]]\n\n*em [[norman]]*');
    expect(countMatches(out, /class="wikilink/g)).toBe(4);
    expect(out).toContain('<h1><a class="wikilink"');
    expect(out).toContain('<li>item <a class="wikilink"');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<em>em <a class="wikilink"');
  });

  it('works inside table cells, including an escaped pipe for the alias', () => {
    const out = html('| name | ref |\n| --- | --- |\n| a | [[norman\\|the old man]] |\n| b | [[ghost]] |');
    expect(out).toContain('<table>');
    expect(countMatches(out, /<tr>/g)).toBe(3);
    // markdown-it removes the table escape before inline parsing, so the raw text has a plain pipe.
    expect(out).toContain('data-link-target="norman" data-kind="entity" data-id="ent_norman">the old man</a>');
    expect(out).toContain('class="wikilink unresolved"');
  });

  it('is not rendered inside inline code or fenced code', () => {
    const inline = html('`[[norman]]`');
    expect(inline).toContain('<code>[[norman]]</code>');
    expect(inline).not.toContain('wikilink');

    const fenced = html('```\n[[norman]]\n```');
    expect(fenced).toContain('[[norman]]');
    expect(fenced).not.toContain('wikilink');
  });

  it('escapes HTML-significant characters in attributes', () => {
    const out = html('[[a&"b"]]');
    expect(out).toContain('data-link-target="a&amp;&quot;b&quot;"');
    expect(out).toContain('>a&amp;&quot;b&quot;</a>');
  });

  it('does not match across a newline', () => {
    expect(html('[[norman\nx]]')).not.toContain('wikilink');
  });
});

// ---------------------------------------------------------------------------
// Embeds
// ---------------------------------------------------------------------------

describe('embeds', () => {
  it('renders a lone embed as a block div around renderEmbed output', () => {
    const ctx: RenderContext = {
      resolveLink,
      renderEmbed: (link, depth) => `<p>EMBED ${link.target} ${depth}</p>`,
    };
    expect(html('![[norman]]', ctx)).toBe(
      '<div class="embed" data-link-target="norman"><p>EMBED norman 1</p></div>\n',
    );
  });

  it('does not wrap a block embed in a paragraph', () => {
    const ctx: RenderContext = { resolveLink, renderEmbed: () => '<p>x</p>' };
    const out = html('Before\n\n![[norman]]\n\nAfter', ctx);
    expect(out).toContain('<p>Before</p>');
    expect(out).toContain('<p>After</p>');
    expect(out).toContain('<div class="embed" data-link-target="norman"><p>x</p></div>');
    expect(out).not.toMatch(/<p><div/);
  });

  it('renders as a plain link when renderEmbed is absent', () => {
    const out = html('![[norman]]');
    expect(out).toContain('<a class="wikilink"');
    expect(out).not.toContain('class="embed"');
  });

  it('renders as a plain link when the target is unresolved', () => {
    const ctx: RenderContext = { resolveLink, renderEmbed: () => '<p>x</p>' };
    const out = html('![[ghost]]', ctx);
    expect(out).toContain('class="wikilink unresolved"');
    expect(out).not.toContain('class="embed"');
  });

  it('renders an embed that is not alone on its line as a plain link', () => {
    const ctx: RenderContext = { resolveLink, renderEmbed: () => '<p>x</p>' };
    const out = html('See ![[norman]] here.', ctx);
    expect(out).not.toContain('class="embed"');
    expect(out).toContain('<a class="wikilink"');
  });

  it('does not embed when the context depth is already 3', () => {
    const out = html('![[norman]]', { resolveLink, depth: 3, renderEmbed: () => '<p>x</p>' });
    expect(out).not.toContain('class="embed"');
    expect(out).toContain('<a class="wikilink"');
  });

  it('stops nested embedding at depth 3', () => {
    const out = html('![[norman]]', recursiveCtx(0));
    // Top level (depth 0), then depth 1 and depth 2 embeds. Depth 3 is a plain link.
    expect(countMatches(out, /class="embed"/g)).toBe(3);
    // The depth-3 render is the only one that falls back to a plain link.
    expect(countMatches(out, /class="wikilink"/g)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Raw HTML
// ---------------------------------------------------------------------------

describe('raw HTML', () => {
  it('escapes raw HTML blocks', () => {
    const out = html('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes inline HTML', () => {
    const out = html('a <b>bold</b> and <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  // Contract: the app puts this HTML into the page with dangerouslySetInnerHTML, and imported vaults are untrusted.
  // Whatever a note, alias, callout, frontmatter value or author note says, no element or handler it makes may run.
  it.each([
    ['a javascript: link', '[click](javascript:alert(1))'],
    ['a wikilink alias that closes the attribute', '[[norman|"><img src=x onerror=alert(1)>]]'],
    ['a wikilink target that closes the attribute', '[[x" onmouseover="alert(1)]]'],
    ['an embed target', '![[x" onmouseover="alert(1)]]'],
    ['a callout type and title', '> [!x"><script>alert(1)</script>] <img src=x onerror=alert(1)>\n> body'],
    ['a frontmatter value', '---\ntitle: "<script>alert(1)</script>"\n"k\\"><img onerror=alert(1)>": 1\n---\nbody'],
  ])('leaves nothing executable from %s', (_what, source) => {
    const out = html(source);
    expect(out).not.toMatch(/<(script|img|iframe|svg|object)\b/i);
    // Text inside a quoted attribute value is inert (its quotes are escaped), so look at the attribute names only.
    expect(out.replace(/"[^"]*"/g, '""')).not.toMatch(/<[^>]*\son\w+\s*=/i);
    expect(out).not.toMatch(/href="\s*javascript:/i);
  });

  it('escapes the text of a shown author note', () => {
    const out = renderMarkdown('before %% <img src=x onerror=alert(1)> %% after', { ...plainCtx, showNotes: true }).html;
    expect(out).not.toMatch(/<img\b/i);
    expect(out).toContain('author-note');
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe('tags', () => {
  it('renders a simple and a nested tag', () => {
    const out = html('#tag and #tag/sub');
    expect(out).toContain('<a class="tag" href="#" data-tag="tag">#tag</a>');
    expect(out).toContain('<a class="tag" href="#" data-tag="tag/sub">#tag/sub</a>');
  });

  it('does not render markdown headings as tags', () => {
    const out = html('# Heading');
    expect(out).toContain('<h1>Heading</h1>');
    expect(out).not.toContain('class="tag"');
  });

  it('does not render tags inside code', () => {
    const out = html('`#nope`\n\n```\n#nope2\n```');
    expect(out).not.toContain('class="tag"');
  });

  it('needs whitespace or start of text before the #', () => {
    expect(html('a#b')).not.toContain('class="tag"');
  });

  it('does not render all-digit tags', () => {
    expect(html('#1984')).not.toContain('class="tag"');
  });

  it('does not render # inside a URL as a tag', () => {
    expect(html('https://example.com/#frag')).not.toContain('class="tag"');
  });

  it('renders tags inside list items', () => {
    expect(html('- #todo item')).toContain('<a class="tag" href="#" data-tag="todo">#todo</a>');
  });
});

// ---------------------------------------------------------------------------
// Callouts
// ---------------------------------------------------------------------------

describe('callouts', () => {
  it('renders a callout with a custom title and body', () => {
    const out = html('> [!note] Heads up\n> body text');
    expect(out).toContain(
      '<div class="callout callout-note"><div class="callout-title">Heads up</div><div class="callout-body">',
    );
    expect(out).toContain('<p>body text</p>');
    expect(out).toContain('</div></div>');
    expect(out).not.toContain('[!note]');
    expect(out).not.toContain('<blockquote>');
  });

  it('uses the capitalised type as title when none is given', () => {
    const out = html('> [!WARNING]\n> careful');
    expect(out).toContain('class="callout callout-warning"');
    expect(out).toContain('<div class="callout-title">Warning</div>');
  });

  it('matches the type case-insensitively', () => {
    expect(html('> [!Tip] Hint\n> x')).toContain('class="callout callout-tip"');
  });

  it('renders wikilinks and other markup in the body', () => {
    const out = html('> [!info] Who\n> see [[norman]] and **bold**');
    expect(out).toContain('class="wikilink"');
    expect(out).toContain('<strong>bold</strong>');
  });

  it('leaves ordinary blockquotes alone', () => {
    const out = html('> just a quote');
    expect(out).toBe('<blockquote>\n<p>just a quote</p>\n</blockquote>\n');
  });

  it('does not treat a marker that is not on the first line as a callout', () => {
    const out = html('> intro\n> [!note] later');
    expect(out).toContain('<blockquote>');
    expect(out).not.toContain('callout');
  });
});

// ---------------------------------------------------------------------------
// Task lists
// ---------------------------------------------------------------------------

describe('task lists', () => {
  it('renders unchecked and checked items with disabled checkboxes', () => {
    const out = html('- [ ] todo\n- [x] done\n- [X] also done');
    expect(out).toContain('<li class="task"><input type="checkbox" disabled> todo</li>');
    expect(out).toContain('<li class="task"><input type="checkbox" disabled checked> done</li>');
    expect(out).toContain('<li class="task"><input type="checkbox" disabled checked> also done</li>');
  });

  it('keeps ordinary list items unchanged', () => {
    const out = html('- plain\n- [ ] task');
    expect(out).toContain('<li>plain</li>');
    expect(out).toContain('<li class="task">');
  });

  it('works in loose lists, where the item is wrapped in a paragraph', () => {
    const out = html('- [x] one\n\n- [ ] two');
    expect(out).toContain('<li class="task">\n<p><input type="checkbox" disabled checked> one</p>');
    expect(out).toContain('<li class="task">\n<p><input type="checkbox" disabled> two</p>');
  });
});

// ---------------------------------------------------------------------------
// GFM and misc
// ---------------------------------------------------------------------------

describe('autolinks', () => {
  it('renders tables', () => {
    expect(html('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>');
  });

  it('renders strikethrough', () => {
    expect(html('~~gone~~')).toBe('<p><s>gone</s></p>\n');
  });

  it('autolinks bare URLs', () => {
    expect(html('see https://example.com')).toContain('<a href="https://example.com"');
  });
});

// ---------------------------------------------------------------------------
// Author notes
// ---------------------------------------------------------------------------

const shownCtx: RenderContext = { ...plainCtx, showNotes: true };

describe('author notes: hidden by default', () => {
  it('removes an inline %% note and collapses the spaces around it', () => {
    expect(html('Before %% secret %% after')).toBe('<p>Before after</p>\n');
  });

  it('removes an inline HTML comment note', () => {
    expect(html('a <!-- hidden --> b')).toBe('<p>a b</p>\n');
  });

  it('removes a note that occupies its own lines without leaving an empty paragraph', () => {
    expect(html('One.\n\n%% gone %%\n\nTwo.')).toBe('<p>One.</p>\n<p>Two.</p>\n');
  });

  it('removes a multi-line note', () => {
    expect(html('a\n\n<!--\nsecret\nmore\n-->\n\nb')).toBe('<p>a</p>\n<p>b</p>\n');
  });

  it('hides links and tags inside notes, so neither renders', () => {
    const out = html('%% [[norman]] #hidden %%');
    expect(out).not.toContain('wikilink');
    expect(out).not.toContain('class="tag"');
    expect(out).not.toContain('norman');
  });

  it('keeps an unclosed marker as literal text', () => {
    expect(html('50%% off and no close')).toContain('50%% off and no close');
  });

  it('does not render embeds inside notes', () => {
    const ctx: RenderContext = {
      resolveLink,
      depth: 0,
      renderEmbed: () => '<b>EMBEDDED</b>',
    };
    const out = html('%% ![[norman]] %%', ctx);
    expect(out).not.toContain('EMBEDDED');
    expect(out).not.toContain('class="embed"');
  });
});

describe('author notes: shown when showNotes is set', () => {
  it('renders an inline %% note as a muted span with its text', () => {
    expect(html('a %% note text %% b', shownCtx)).toBe('<p>a <span class="author-note">note text</span> b</p>\n');
  });

  it('renders an HTML comment note the same way', () => {
    expect(html('a <!-- x --> b', shownCtx)).toBe('<p>a <span class="author-note">x</span> b</p>\n');
  });

  it('renders several notes in order', () => {
    const out = html('a %% one %% b %% two %%', shownCtx);
    expect(out).toContain('<span class="author-note">one</span>');
    expect(out.indexOf('one')).toBeLessThan(out.indexOf('two'));
    expect(out.match(/author-note/g)).toHaveLength(2);
  });

  it('escapes note text and does not format it as markdown', () => {
    const out = html('%% <b>&amp; **bold**  [[norman]] %%', shownCtx);
    expect(out).toContain('<span class="author-note">&lt;b&gt;&amp;amp; **bold**  [[norman]]</span>');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<strong>');
    expect(out).not.toContain('class="wikilink');
  });

  it('shows a note on its own line as its own paragraph', () => {
    expect(html('one\n\n%% aside %%\n\ntwo', shownCtx)).toBe(
      '<p>one</p>\n<p><span class="author-note">aside</span></p>\n<p>two</p>\n',
    );
  });

  it('does not render links or tags inside a shown note as links', () => {
    const out = html('%% [[norman]] #tag %%', shownCtx);
    expect(out).not.toContain('class="wikilink');
    expect(out).not.toContain('class="tag"');
  });

  it('still renders links outside notes', () => {
    const out = html('x %% [[norman]] %% [[norman]]', shownCtx);
    expect(out.match(/class="wikilink"/g)).toHaveLength(1);
    expect(out).toContain('<span class="author-note">[[norman]]</span>');
  });
});

describe('author notes: code is literal', () => {
  it('leaves %% inside inline code untouched, hidden or shown', () => {
    const text = 'Use `%% not a note %%` here.';
    const expected = '<p>Use <code>%% not a note %%</code> here.</p>\n';
    expect(html(text)).toBe(expected);
    expect(html(text, shownCtx)).toBe(expected);
  });

  it('leaves %% inside a fenced block untouched, hidden or shown', () => {
    const text = '```\n%% code %%\n```';
    const expected = '<pre><code>%% code %%\n</code></pre>\n';
    expect(html(text)).toBe(expected);
    expect(html(text, shownCtx)).toBe(expected);
  });

  it('leaves an HTML comment inside code untouched', () => {
    const out = html('`<!-- x -->`', shownCtx);
    expect(out).toContain('<code>&lt;!-- x --&gt;</code>');
    expect(out).not.toContain('author-note');
  });

  it('still hides a real note placed after a code span', () => {
    expect(html('`code` then %% hidden %% end')).toBe('<p><code>code</code> then end</p>\n');
  });
});

describe('author notes: // line notes', () => {
  it('hides a trailing // note and keeps the line break after the text', () => {
    expect(html('Before // secret\nafter')).toBe('<p>Before\nafter</p>\n');
  });

  it('hides a whole-line // note without leaving an empty paragraph', () => {
    expect(html('one\n\n// aside\n\ntwo')).toBe('<p>one</p>\n<p>two</p>\n');
  });

  it('hides links and tags written in a // note', () => {
    expect(html('x // [[norman]] #tag')).toBe('<p>x</p>\n');
  });

  it('shows a // note as a muted span when showNotes is set', () => {
    expect(html('a // [[norman]]', shownCtx)).toBe('<p>a <span class="author-note">[[norman]]</span></p>\n');
  });

  it('keeps a URL as a link, not a note', () => {
    expect(html('see https://example.com for maps')).toContain('href="https://example.com"');
  });
});

describe('author notes: frontmatter', () => {
  it('still parses frontmatter when notes are present', () => {
    const r = renderMarkdown('---\ntitle: Norman\n---\nbody %% n %%', plainCtx);
    expect(r.frontmatter).toEqual({ title: 'Norman' });
    expect(r.html).toContain('<p>body</p>');
  });
});

describe('stored pictures: ![caption](img:ID)', () => {
  const images: Record<string, { src: string; ai?: boolean }> = {
    plain: { src: 'data:image/png;base64,AAAA' },
    made: { src: 'data:image/png;base64,BBBB', ai: true },
  };
  const ctx: RenderContext = { ...plainCtx, resolveImage: (id) => images[id] };

  it('shows the stored picture, and wraps one made by a model so it can carry the watermark', () => {
    expect(renderMarkdown('![A cup](img:plain)', ctx).html).toBe('<p><img src="data:image/png;base64,AAAA" alt="A cup"></p>\n');
    expect(renderMarkdown('![A cup](img:made)', ctx).html).toBe('<p><span class="ai-mark"><img src="data:image/png;base64,BBBB" alt="A cup"></span></p>\n');
  });

  it('renders nothing for a picture it cannot resolve, so an export never carries a broken image', () => {
    expect(renderMarkdown('before ![x](img:gone) after', ctx).html).toBe('<p>before  after</p>\n');
    expect(renderMarkdown('before ![x](img:plain) after', plainCtx).html).toBe('<p>before  after</p>\n');
  });
});
