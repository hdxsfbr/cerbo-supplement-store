// Tiny forward-only SQL migration runner.
//
// Applies `./migrations/*.sql` in lexical order, each inside its own transaction, and records
// the filename in `schema_migrations`. Runs on API boot (index.ts) and via `npm run migrate`.
// A session-level advisory lock serialises concurrent boots (e.g. two replicas starting).
// There is no "down": migrations here define money invariants and seeds; rolling those back
// is a new forward migration, same as the ledger it protects.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './client.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const LOCK_KEY = 0x6365_7262; // 'cerb'

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function listMigrationFiles(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const seen = new Set<string>();
  for (const f of files) {
    const prefix = f.slice(0, 3);
    if (seen.has(prefix)) throw new Error(`Duplicate migration number ${prefix} (${f})`);
    seen.add(prefix);
  }
  return files;
}

export async function runMigrations(
  sql: Db,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

  const result: MigrationResult = { applied: [], alreadyApplied: [] };

  // Hold the advisory lock for the whole run on a single reserved connection.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
    const done = new Set(
      (await tx<{ filename: string }[]>`SELECT filename FROM schema_migrations`).map(
        (r) => r.filename,
      ),
    );
    for (const file of await listMigrationFiles(dir)) {
      if (done.has(file)) {
        result.alreadyApplied.push(file);
        continue;
      }
      const body = await readFile(path.join(dir, file), 'utf8');
      // One transaction for the whole batch: a failing file aborts every file in this run and
      // reports its own name; files applied in earlier runs are untouched.
      try {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
        result.applied.push(file);
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  });

  return result;
}

export async function migrationStatus(
  sql: Db,
): Promise<{ applied: number; latest: string | null }> {
  const rows = await sql<{ filename: string }[]>`
    SELECT filename FROM schema_migrations ORDER BY filename`;
  return { applied: rows.length, latest: rows.at(-1)?.filename ?? null };
}

// CLI: `npm run migrate` (tsx src/db/migrate.ts)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { createDb } = await import('./client.js');
  const { loadConfig } = await import('../config.js');
  const sql = createDb(loadConfig().databaseUrl, { max: 1 });
  try {
    const r = await runMigrations(sql);
    console.log(
      `migrations: ${r.applied.length} applied, ${r.alreadyApplied.length} already applied`,
    );
    for (const f of r.applied) console.log(`  + ${f}`);
  } finally {
    await sql.end();
  }
}
