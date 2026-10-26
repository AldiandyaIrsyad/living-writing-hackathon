// Upgrading saved data from an older format to the current one, one version at a time.
//
// A registry maps n to the step that turns format n into format n+1. The current version is therefore 1 plus the number of
// steps, and the data is never read in a shape the code does not know: it is upgraded first. Steps are append-only; a step
// that has shipped is never edited or removed, because someone's archive may still be at that version.

export type Migrations<T> = Record<number, (value: T) => T>;

/** The newest version a registry can produce. Version 1 needs no step. */
export function currentVersion(migrations: Record<number, unknown>): number {
  return 1 + Object.keys(migrations).length;
}

/**
 * Applies every step from `from` up to the current version. `clone` copies the value before each step, so a step that
 * throws (or mutates what it should not) leaves the caller's original untouched. Throws with a plain message for a
 * version that is newer than the registry, not a whole number, or has a gap in its chain.
 */
export function runMigrations<T>(value: T, from: number, migrations: Migrations<T>, clone: (v: T) => T = (v) => v): { value: T; version: number } {
  const target = currentVersion(migrations);
  if (!Number.isInteger(from) || from < 1) throw new Error(`the version must be a whole number, 1 or more (found ${String(from)})`);
  if (from > target) throw new Error(`made by a newer version (format ${from}, this app reads ${target})`);
  let current = value;
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`there is no way to upgrade format ${v}`);
    try {
      current = step(clone(current));
    } catch (e) {
      throw new Error(`could not upgrade from format ${v} to ${v + 1}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
  return { value: current, version: target };
}
