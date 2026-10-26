// Author notes: comments inside prose/notes that are for the writer only.
// Syntax:
//   - Obsidian `%% … %%` or HTML `<!-- … -->`, inline or spanning lines.
//   - `// …` line comment: from the `//` to the end of the line. It only starts a note when the
//     `//` is at the start of a line or preceded by whitespace, so `https://…` is never one.
//
// These functions are code-agnostic: they see every marker. Callers that must respect code
// spans and fenced blocks use `findAuthorNotesOutsideCode` from ./links.ts.

export interface AuthorNote {
  start: number;
  /** Exclusive. */
  end: number;
  /** Text inside the markers, trimmed. */
  text: string;
  syntax: 'percent' | 'html' | 'line';
}

// Alternatives are tried left to right at each position, so the earliest marker wins: a `//`
// inside `%% … %%` is content, and a `%%` after a `//` on the same line is part of that comment.
const NOTE_RE = /%%([\s\S]*?)%%|<!--([\s\S]*?)-->|(?<!\S)\/\/([^\r\n]*)/g;

/** Cheap pre-check: false when the text cannot contain any note marker. Shared with links.ts. */
export function mayHaveNote(text: string): boolean {
  return text.includes('%%') || text.includes('<!--') || text.includes('//');
}

/** Every author note in the text, in order. Unclosed markers are not notes. */
export function findAuthorNotes(text: string): AuthorNote[] {
  const out: AuthorNote[] = [];
  for (const m of text.matchAll(NOTE_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[3] !== undefined) {
      out.push({ start, end, text: m[3].trim(), syntax: 'line' });
    } else {
      const inner = m[1] ?? m[2] ?? '';
      out.push({ start, end, text: inner.trim(), syntax: m[1] !== undefined ? 'percent' : 'html' });
    }
  }
  return out;
}

/**
 * Remove author notes. A note that occupies whole lines removes those lines, so stripping
 * doesn't leave stray blank paragraphs. Inline notes collapse the whitespace they were
 * separated by, so `a %% x %% b` becomes `a b`.
 */
export function stripAuthorNotes(text: string): string {
  if (!mayHaveNote(text)) return text;
  return stripNotes(text, findAuthorNotes(text));
}

/**
 * Removes the given notes (sorted and non-overlapping, as `findAuthorNotes` returns them)
 * using the same rules as `stripAuthorNotes`. Lets callers pick which notes to remove, for
 * example only those outside code.
 */
export function stripNotes(text: string, notes: AuthorNote[]): string {
  let out = '';
  let last = 0;
  for (const n of notes) {
    const lineStart = text.lastIndexOf('\n', n.start - 1) + 1;
    const nl = text.indexOf('\n', n.end);
    const lineEnd = nl < 0 ? text.length : nl;
    const startBlank = text.slice(lineStart, n.start).trim() === '';
    const restBlank = text.slice(n.end, lineEnd).trim() === '';

    if (startBlank && restBlank && lineStart >= last) {
      // Whole lines: drop them including their newline.
      out += text.slice(last, lineStart);
      last = nl < 0 ? text.length : nl + 1;
    } else if (restBlank) {
      // Note ends a line that has text before it: drop the separating spaces, keep the newline.
      out += text.slice(last, n.start).replace(/[ \t]+$/, '');
      last = lineEnd;
    } else if (startBlank) {
      // Note starts a line that has text after it: drop the spaces that follow it.
      out += text.slice(last, n.start);
      let k = n.end;
      while (k < lineEnd && (text[k] === ' ' || text[k] === '\t')) k++;
      last = k;
    } else {
      // Inline: keep one space where the note had spaces on both sides, else join directly.
      const before = text.slice(last, n.start);
      const spaceBefore = /[ \t]$/.test(before);
      const spaceAfter = /^[ \t]/.test(text.slice(n.end, lineEnd));
      if (spaceBefore && spaceAfter) {
        out += before.replace(/[ \t]+$/, '') + ' ';
        let k = n.end;
        while (k < lineEnd && (text[k] === ' ' || text[k] === '\t')) k++;
        last = k;
      } else {
        out += before;
        last = n.end;
      }
    }
  }
  return out + text.slice(last);
}

/** True if `pos` falls inside an author note. */
export function inAuthorNote(notes: AuthorNote[], pos: number): boolean {
  return notes.some((n) => pos >= n.start && pos < n.end);
}
