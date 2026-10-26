// Concrete dates and reprogrammable calendar system. Pure TS — no React, no DOM.
//
// In Living Writing, default time is relative and dynamic (columns 1, 2, 3... can mean minutes, days or years).
// A "Concrete" is a guaranteed date/time anchor on a moment (e.g. "2026-10-25", "2026-10", "2026", "Winter, 2026").
// When two moments carry comparable Concretes, the earlier Concrete acts as an absolute ordering constraint (`before -> after`).

import type { Id, Moment, Vault } from './types';

export interface SeasonDef {
  name: string;
  aliases?: string[];
  /** 1-based ordinal within the year (1..N) or fractional month position for ordering. */
  order: number;
}

export interface MonthDef {
  name: string;
  short?: string;
  days: number;
}

/**
 * Reprogrammable calendar definition. Defaults to standard ISO / 4-season calendar,
 * ready for custom month lengths or fantasy calendars via a future Custom Date Maker.
 */
export interface CalendarSystem {
  id: string;
  name: string;
  months: MonthDef[];
  seasons: SeasonDef[];
}

export const DEFAULT_CALENDAR: CalendarSystem = {
  id: 'iso-standard',
  name: 'ISO / Four Seasons',
  months: [
    { name: 'January', short: 'Jan', days: 31 },
    { name: 'February', short: 'Feb', days: 29 },
    { name: 'March', short: 'Mar', days: 31 },
    { name: 'April', short: 'Apr', days: 30 },
    { name: 'May', short: 'May', days: 31 },
    { name: 'June', short: 'Jun', days: 30 },
    { name: 'July', short: 'Jul', days: 31 },
    { name: 'August', short: 'Aug', days: 31 },
    { name: 'September', short: 'Sep', days: 30 },
    { name: 'October', short: 'Oct', days: 31 },
    { name: 'November', short: 'Nov', days: 30 },
    { name: 'December', short: 'Dec', days: 31 },
  ],
  seasons: [
    { name: 'Spring', order: 1 },
    { name: 'Summer', order: 2 },
    { name: 'Autumn', aliases: ['Fall'], order: 3 },
    { name: 'Winter', order: 4 },
  ],
};

export type ConcretePrecision = 'year' | 'season' | 'month' | 'day';

export interface ParsedConcrete {
  raw: string;
  year: number;
  precision: ConcretePrecision;
  /** 1-based season index (when precision === 'season'). */
  season?: number;
  seasonName?: string;
  /** Modifier within a season/year: early (-0.25), mid (0), late (+0.25). */
  modifier?: 'early' | 'mid' | 'late';
  /** 1-based month index (when precision === 'month' or 'day'). */
  month?: number;
  /** 1-based day of month (when precision === 'day'). */
  day?: number;
  /**
   * Normalized numeric sort key: `year * 10000 + fractionOfYear * 10000`.
   * Two Concretes are strictly ordered when both are parsed and their sort ranges do not ambiguously overlap.
   */
  sortKey: number;
  /** Canonical display string. */
  canonical: string;
}

const MODIFIER_OFFSET: Record<'early' | 'mid' | 'late', number> = {
  early: -0.2,
  mid: 0,
  late: 0.2,
};

/**
 * Parses a Concrete string using the given calendar system.
 * Supported formats:
 * - ISO date: `2026-10-25`, `2026/10/25`
 * - ISO year-month: `2026-10`, `2026/10`
 * - Named month + year: `October 2026`, `Oct, 2026`, `25 October 2026`, `October 25, 2026`
 * - Season + year: `Autumn, 2026`, `Winter 2026`, `Late Autumn, 2026`, `Early Winter, Year 3`
 * - Year only: `2026`, `Year 3`
 * Returns null if the text is a freeform unparseable note (e.g. "The night of the fire" without a year).
 */
export function parseConcrete(raw: string, calendar: CalendarSystem = DEFAULT_CALENDAR): ParsedConcrete | null {
  const text = raw.trim();
  if (!text) return null;

  const monthCount = Math.max(1, calendar.months.length);
  const seasonCount = Math.max(1, calendar.seasons.length);

  // 1. ISO YYYY-MM-DD or YYYY-MM
  const iso = /^(-?\d{1,6})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = iso[3] !== undefined ? Number(iso[3]) : undefined;
    if (month < 1 || month > monthCount) return null;
    const maxDays = calendar.months[month - 1]?.days ?? 31;
    if (day !== undefined && (day < 1 || day > maxDays)) return null;
    const monthFrac = (month - 1) / monthCount;
    const dayFrac = day !== undefined ? (day - 1) / (monthCount * (maxDays + 1)) : 0;
    const sortKey = Math.round((year + monthFrac + dayFrac) * 10000);
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return {
      raw: text,
      year,
      precision: day !== undefined ? 'day' : 'month',
      month,
      ...(day !== undefined ? { day } : {}),
      sortKey,
      canonical: day !== undefined ? `${ym}-${String(day).padStart(2, '0')}` : ym,
    };
  }

  // 2. Season + Year: e.g. "Autumn, 2026", "Autumn of 2026", "Late Winter 2026", "Early Spring, Year 3"
  const seasonMatch = /^(?:(early|mid|late)\s+)?([a-zA-Z]+)(?:[\s,]+(?:of\s+)?(?:year\s+)?(-?\d{1,6}))$/i.exec(text);
  if (seasonMatch) {
    const modRaw = seasonMatch[1]?.toLowerCase() as 'early' | 'mid' | 'late' | undefined;
    const word = seasonMatch[2].toLowerCase();
    const year = Number(seasonMatch[3]);
    const seasonDef = calendar.seasons.find(
      (s) => s.name.toLowerCase() === word || s.aliases?.some((a) => a.toLowerCase() === word),
    );
    if (seasonDef) {
      const modOffset = modRaw ? MODIFIER_OFFSET[modRaw] : 0;
      const frac = (seasonDef.order - 0.5 + modOffset) / seasonCount;
      const sortKey = Math.round((year + frac) * 10000);
      const prefix = modRaw ? `${modRaw[0].toUpperCase()}${modRaw.slice(1)} ` : '';
      return {
        raw: text,
        year,
        precision: 'season',
        season: seasonDef.order,
        seasonName: seasonDef.name,
        ...(modRaw ? { modifier: modRaw } : {}),
        sortKey,
        canonical: `${prefix}${seasonDef.name}, ${year}`,
      };
    }

    // Check if `word` is actually a Month name ("October, 2026" or "Oct 2026")
    const monthIdx = calendar.months.findIndex(
      (m) => m.name.toLowerCase() === word || m.short?.toLowerCase() === word,
    );
    if (monthIdx >= 0 && !modRaw) {
      const month = monthIdx + 1;
      const frac = (month - 1) / monthCount;
      const sortKey = Math.round((year + frac) * 10000);
      return {
        raw: text,
        year,
        precision: 'month',
        month,
        sortKey,
        canonical: `${year}-${String(month).padStart(2, '0')}`,
      };
    }
  }

  // 3. Named Month + Day + Year: "October 25, 2026", "October 25th, 2026", or "25th October 2026"
  const mdy = /^([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(-?\d{1,6})$/i.exec(text);
  const dmy = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-zA-Z]+),?\s+(-?\d{1,6})$/i.exec(text);
  const namedParts = mdy ? { mWord: mdy[1], dStr: mdy[2], yStr: mdy[3] } : dmy ? { mWord: dmy[2], dStr: dmy[1], yStr: dmy[3] } : null;
  if (namedParts) {
    const word = namedParts.mWord.toLowerCase();
    const monthIdx = calendar.months.findIndex(
      (m) => m.name.toLowerCase() === word || m.short?.toLowerCase() === word,
    );
    if (monthIdx >= 0) {
      const month = monthIdx + 1;
      const day = Number(namedParts.dStr);
      const year = Number(namedParts.yStr);
      const maxDays = calendar.months[monthIdx]?.days ?? 31;
      if (day >= 1 && day <= maxDays) {
        const monthFrac = (month - 1) / monthCount;
        const dayFrac = (day - 1) / (monthCount * (maxDays + 1));
        const sortKey = Math.round((year + monthFrac + dayFrac) * 10000);
        return {
          raw: text,
          year,
          precision: 'day',
          month,
          day,
          sortKey,
          canonical: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        };
      }
    }
  }

  // 3b. US/EU numeric slash date: MM/DD/YYYY or DD/MM/YYYY (e.g. "10/25/2026")
  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(-?\d{3,6})$/.exec(text);
  if (slashDate) {
    const a = Number(slashDate[1]);
    const b = Number(slashDate[2]);
    const year = Number(slashDate[3]);
    const [month, day] = a > monthCount && b <= monthCount ? [b, a] : [a, b];
    const maxDays = calendar.months[month - 1]?.days ?? 31;
    if (month >= 1 && month <= monthCount && day >= 1 && day <= maxDays) {
      const monthFrac = (month - 1) / monthCount;
      const dayFrac = (day - 1) / (monthCount * (maxDays + 1));
      const sortKey = Math.round((year + monthFrac + dayFrac) * 10000);
      return {
        raw: text,
        year,
        precision: 'day',
        month,
        day,
        sortKey,
        canonical: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      };
    }
  }

  // 3c. Relative narrative "Day N" or "Year Y, Day D": e.g. "Day 4", "Year 2, Day 15"
  const narrativeDay = /^(?:year\s+(-?\d{1,6})[\s,]+)?day\s+(\d{1,4})$/i.exec(text);
  if (narrativeDay) {
    const year = narrativeDay[1] !== undefined ? Number(narrativeDay[1]) : 0;
    const dayOfYear = Number(narrativeDay[2]);
    if (dayOfYear >= 1) {
      return {
        raw: text,
        year,
        precision: 'day',
        day: dayOfYear,
        sortKey: year * 10000 + dayOfYear,
        canonical: narrativeDay[1] !== undefined ? `Year ${year}, Day ${dayOfYear}` : `Day ${dayOfYear}`,
      };
    }
  }

  // 4. Plain Year, "Year N", or BC/BCE/AD/CE: "2026", "Year 3", "44 BC", "44 BCE"
  const yearOnly = /^(?:year\s+)?(-?\d{1,6})(?:\s*(bc|bce|ad|ce))?$/i.exec(text);
  if (yearOnly) {
    const rawYear = Number(yearOnly[1]);
    const era = yearOnly[2]?.toLowerCase();
    const isBc = era === 'bc' || era === 'bce';
    const year = isBc ? -Math.abs(rawYear) : rawYear;
    return {
      raw: text,
      year,
      precision: 'year',
      sortKey: year * 10000,
      canonical: isBc ? `${Math.abs(rawYear)} ${era.toUpperCase()}` : /^year\s+/i.test(text) ? `Year ${year}` : `${year}`,
    };
  }

  return null;
}

/**
 * Compares two ParsedConcretes chronologically:
 * - returns -1 if `a` is strictly before `b`
 * - returns 1 if `a` is strictly after `b`
 * - returns 0 if they represent the same Concrete point or one is a coarse container of the other (e.g. "2026" and "Autumn, 2026")
 */
export function compareConcretes(a: ParsedConcrete, b: ParsedConcrete): -1 | 0 | 1 {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  // Within the same year, if either is just 'year' precision, don't force strict before/after against a month/season in that same year.
  if (a.precision === 'year' || b.precision === 'year') return 0;
  if (a.sortKey === b.sortKey) return 0;
  return a.sortKey < b.sortKey ? -1 : 1;
}

/** Reads the concrete text from a moment (supporting legacy `label` as fallback). */
export function momentConcrete(m: Moment | undefined): string | undefined {
  if (!m) return undefined;
  return m.concrete ?? m.label;
}

/**
 * Derives implicit ordering edges from moments that have parseable Concrete timestamps.
 * Moments sorted by their Concrete sortKey are chained (`m_earlier -> m_later`) so that
 * Concrete acts as an absolute constraint in the moment graph.
 */
export function concreteEdges(
  moments: Record<Id, Moment>,
  calendar: CalendarSystem = DEFAULT_CALENDAR,
): { before: Id; after: Id }[] {
  const parsed: { id: Id; c: ParsedConcrete }[] = [];
  for (const m of Object.values(moments)) {
    const text = momentConcrete(m);
    if (!text) continue;
    const c = parseConcrete(text, calendar);
    if (c) parsed.push({ id: m.id, c });
  }
  if (parsed.length < 2) return [];
  parsed.sort((a, b) => a.c.sortKey - b.c.sortKey || a.id.localeCompare(b.id));

  // Separate year-only concretes from specific (month/season/day) concretes so we can chain adjacent groups in O(k).
  const specific = parsed.filter((x) => x.c.precision !== 'year');
  const yearOnly = parsed.filter((x) => x.c.precision === 'year');

  const edges: { before: Id; after: Id }[] = [];

  // 1. Chain distinct sortKey buckets among specific concretes (O(k))
  const buckets: { sortKey: number; year: number; ids: Id[] }[] = [];
  for (const item of specific) {
    const last = buckets[buckets.length - 1];
    if (last && last.sortKey === item.c.sortKey) last.ids.push(item.id);
    else buckets.push({ sortKey: item.c.sortKey, year: item.c.year, ids: [item.id] });
  }
  for (let i = 0; i + 1 < buckets.length; i++) {
    for (const a of buckets[i].ids) {
      for (const b of buckets[i + 1].ids) {
        edges.push({ before: a, after: b });
      }
    }
  }

  // 2. Connect year-only concretes to adjacent years
  if (yearOnly.length > 0) {
    for (let i = 0; i < yearOnly.length; i++) {
      for (let j = i + 1; j < yearOnly.length; j++) {
        if (yearOnly[i].c.year < yearOnly[j].c.year) {
          edges.push({ before: yearOnly[i].id, after: yearOnly[j].id });
          break;
        }
      }
      for (const b of buckets) {
        if (b.year < yearOnly[i].c.year) {
          for (const id of b.ids) edges.push({ before: id, after: yearOnly[i].id });
        } else if (b.year > yearOnly[i].c.year) {
          for (const id of b.ids) edges.push({ before: yearOnly[i].id, after: id });
        }
      }
    }
  }

  return edges;
}

/**
 * Checks whether a query matches a moment's Concrete (by raw text, canonical text, year, season name, or month name).
 */
export function matchesConcrete(concreteText: string, query: string, calendar: CalendarSystem = DEFAULT_CALENDAR): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (concreteText.toLowerCase().includes(q)) return true;
  const p = parseConcrete(concreteText, calendar);
  if (!p) return false;
  if (p.canonical.toLowerCase().includes(q)) return true;
  if (String(p.year) === q) return true;
  if (p.seasonName && p.seasonName.toLowerCase().includes(q)) return true;
  if (p.month !== undefined) {
    const m = calendar.months[p.month - 1];
    if (m && (m.name.toLowerCase().includes(q) || m.short?.toLowerCase() === q)) return true;
  }
  return false;
}

/** Returns all scenes whose moment carries a Concrete matching `query` (or all scenes with any Concrete when `query` is empty). */
export function findScenesByConcrete(
  vault: Vault,
  query: string,
  calendar: CalendarSystem = DEFAULT_CALENDAR,
): { sceneId: Id; concrete: string; parsed: ParsedConcrete | null }[] {
  const out: { sceneId: Id; concrete: string; parsed: ParsedConcrete | null }[] = [];
  const q = query.trim();
  for (const s of Object.values(vault.scenes)) {
    const text = momentConcrete(vault.moments[s.momentId]);
    if (!text) continue;
    if (q === '' || matchesConcrete(text, q, calendar)) {
      out.push({ sceneId: s.id, concrete: text, parsed: parseConcrete(text, calendar) });
    }
  }
  return out;
}
