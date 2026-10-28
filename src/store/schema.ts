// The shape of the vault as saved in this browser's database, and how an older one is brought up to date on load.
//
// Separate from the export format (core/exchange.ts): the database can change without the exports changing and the other
// way round. Version 1 is everything saved so far, including databases from before a version was recorded.

import { currentVersion, type Migrations } from '../core/migrate';
import type { Vault } from '../core/types';

/** Steps that upgrade a loaded vault from schema n to n+1. Append-only; see core/migrate.ts. */
export const VAULT_MIGRATIONS: Migrations<Vault> = {
  // 1 → 2: the review list. A database from before it has no such rows.
  1: (vault) => ({ ...vault, reviewItems: vault.reviewItems ?? {} }),
  // 2 → 3: scene status, an optional field. Nothing to change; the bump keeps an older build from writing over it.
  2: (vault) => vault,
  // 3 → 4: the image store. A database from before it has no such rows.
  3: (vault) => ({ ...vault, images: vault.images ?? {} }),
};

export const SCHEMA_VERSION = currentVersion(VAULT_MIGRATIONS);
