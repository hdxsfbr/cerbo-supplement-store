// Thin Postgres client (porsager/postgres). No ORM: money SQL stays visible in the routes.
//
// Two deliberate choices (constitution I):
//  * snake_case columns ⇄ camelCase properties via `postgres.camel`, so `total_cents` arrives
//    as `totalCents` — the `Cents` suffix marks integer-cent fields in TS.
//  * BIGINT (oid 20) is parsed into a JS number *only if* it is a safe integer; otherwise we
//    throw rather than silently lose precision. Cent totals in this system are nowhere near
//    2^53, so this is a tripwire, not an expected path.

import postgres, { type Sql } from 'postgres';

export type Db = Sql;

export function parseBigintColumn(text: string): number {
  const n = Number(text);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`BIGINT value ${text} exceeds Number.isSafeInteger; refusing to coerce`);
  }
  return n;
}

export function createDb(databaseUrl: string, opts: { max?: number } = {}): Db {
  return postgres(databaseUrl, {
    max: opts.max ?? 10,
    transform: postgres.camel,
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => {
          if (typeof value === 'number' && !Number.isSafeInteger(value)) {
            throw new RangeError(`Refusing to write non-safe-integer ${value} to a BIGINT column`);
          }
          return value.toString();
        },
        parse: parseBigintColumn,
      },
    },
    onnotice: () => {}, // migrations are chatty (IF NOT EXISTS etc.); keep boot logs clean
  });
}
