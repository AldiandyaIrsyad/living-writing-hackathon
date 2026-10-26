// Three-way text merge by lines, for the one case folder sync meets: the same file edited here and outside the app since
// the last time they agreed. Edits to different places merge; edits to the same place are a conflict, never a guess. Pure.

export type Merge = { clean: true; text: string } | { clean: false };

/** Beyond this many line pairs the comparison is not attempted and the merge reports a conflict. */
const MAX_CELLS = 6_000_000;

interface Hunk {
  /** Base lines [start, end) are replaced by `lines`. A hunk with start === end is a pure insertion. */
  start: number;
  end: number;
  lines: string[];
}

/** Pairs [i, j] of equal lines in a longest common subsequence of a and b, in order. */
function matches(a: string[], b: string[]): [number, number][] | null {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push([i++, j++]);
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** How `side` differs from `base`, as the stretches of base it replaces. */
function hunksOf(base: string[], side: string[]): Hunk[] | null {
  const pairs = matches(base, side);
  if (!pairs) return null;
  const out: Hunk[] = [];
  let bi = 0;
  let si = 0;
  for (const [i, j] of [...pairs, [base.length, side.length] as [number, number]]) {
    if (i > bi || j > si) out.push({ start: bi, end: i, lines: side.slice(si, j) });
    bi = i + 1;
    si = j + 1;
  }
  return out;
}

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Hunks that cannot both apply: they replace overlapping stretches, or start at the same place. */
function collide(a: Hunk, b: Hunk): boolean {
  return a.start === b.start || (a.start < b.end && b.start < a.end);
}

/**
 * Merges `ours` and `theirs`, both edits of `base`. Line endings are compared as if all were LF, so a file an editor
 * re-saved with CRLF does not conflict with itself; the result uses CRLF when `ours` does.
 */
export function mergeText(base: string, ours: string, theirs: string): Merge {
  const crlf = ours.includes('\r\n');
  const lines = (s: string) => s.replace(/\r\n/g, '\n').split('\n');
  const b = lines(base);
  const ha = hunksOf(b, lines(ours));
  const hb = hunksOf(b, lines(theirs));
  if (!ha || !hb) return { clean: false };

  const out: string[] = [];
  let at = 0;
  let ia = 0;
  let ib = 0;
  while (ia < ha.length || ib < hb.length) {
    const a = ha[ia];
    const t = hb[ib];
    let hunk: Hunk;
    if (a && t && collide(a, t)) {
      if (a.start !== t.start || a.end !== t.end || !sameLines(a.lines, t.lines)) return { clean: false };
      hunk = a; // both made the identical edit
      ia++;
      ib++;
    } else if (a && (!t || a.start <= t.start)) {
      hunk = a;
      ia++;
    } else {
      hunk = t!;
      ib++;
    }
    out.push(...b.slice(at, hunk.start), ...hunk.lines);
    at = hunk.end;
  }
  out.push(...b.slice(at));
  const text = out.join('\n');
  return { clean: true, text: crlf ? text.replace(/\n/g, '\r\n') : text };
}
