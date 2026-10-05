// Integration-test harness: a fresh, fully-migrated database per test file + the app built with
// the fake seams. Needs DATABASE_URL pointing at a reachable Postgres with CREATEDB rights
// (docker compose up -d db). The ledger is append-only, so "truncate between tests" is not an
// option by design — hence a throwaway database instead.

import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { createDb, type Db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { buildApp } from '../../src/app.js';
import { SeededIdentity } from '../../src/seams/identity.js';
import { FakePaymentGateway } from '../../src/seams/payment.js';
import type { Notifier, PaymentNotification } from '../../src/seams/notifier.js';

export const PUBLIC_WEB_ORIGIN = 'http://web.test';

export class RecordingNotifier implements Notifier {
  sent: PaymentNotification[] = [];
  async orderReadyForPayment(n: PaymentNotification): Promise<void> {
    this.sent.push(n);
  }
}

export interface TestContext {
  sql: Db;
  app: FastifyInstance;
  notifier: RecordingNotifier;
  /** Drop the database and close everything. */
  teardown(): Promise<void>;
}

function baseUrl(): URL {
  const raw = process.env.DATABASE_URL ?? 'postgres://cerbo:cerbo@localhost:5432/cerbo_store';
  return new URL(raw);
}

export async function createTestContext(): Promise<TestContext> {
  const url = baseUrl();
  const dbName = `cerbo_test_${randomBytes(6).toString('hex')}`;

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);

  const testUrl = new URL(url.toString());
  testUrl.pathname = `/${dbName}`;
  const sql = createDb(testUrl.toString(), { max: 4 });
  await runMigrations(sql);

  const notifier = new RecordingNotifier();
  const app = await buildApp({
    sql,
    identity: new SeededIdentity(sql),
    gateway: new FakePaymentGateway(),
    notifier,
    publicWebOrigin: PUBLIC_WEB_ORIGIN,
    staticDir: null,
    logger: false,
  });
  await app.ready();

  return {
    sql,
    app,
    notifier,
    async teardown() {
      await app.close();
      await sql.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE ${dbName} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    },
  };
}

/** Shorthand for app.inject with JSON body + acting provider header. */
export async function api(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  opts: { body?: unknown; provider?: number | string } = {},
) {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(opts.provider !== undefined ? { 'x-acting-provider': String(opts.provider) } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  });
  const text = res.body;
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.statusCode, body: json as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
