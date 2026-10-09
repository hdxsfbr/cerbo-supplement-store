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
import {
  FakePaymentGateway,
  type ChargeRequest,
  type ChargeResult,
  type PaymentGateway,
} from '../../src/seams/payment.js';
import {
  PortalNotifier,
  type Notifier,
  type PaymentNotification,
  type RequestDeclinedNotification,
} from '../../src/seams/notifier.js';

export const PUBLIC_WEB_ORIGIN = 'http://web.test';

/** Records calls AND delivers through the real PortalNotifier so portal tests see rows. */
export class RecordingNotifier implements Notifier {
  sent: PaymentNotification[] = [];
  failNext = false;
  inner: Notifier | null = null;
  async orderReadyForPayment(n: PaymentNotification): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('smtp down (test)');
    }
    this.sent.push(n);
    await this.inner?.orderReadyForPayment(n);
  }
  declined: RequestDeclinedNotification[] = [];
  async requestDeclined(n: RequestDeclinedNotification): Promise<void> {
    this.declined.push(n);
    await this.inner?.requestDeclined(n);
  }
}

/** Fake gateway that records every call and can be switched to decline or blow up. */
export class RecordingGateway implements PaymentGateway {
  calls: ChargeRequest[] = [];
  mode: 'succeed' | 'decline' | 'outage' = 'succeed';
  private readonly inner = new FakePaymentGateway();
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(req);
    if (this.mode === 'decline') {
      const { PaymentDeclinedError } = await import('../../src/seams/payment.js');
      throw new PaymentDeclinedError('card declined (test)', 'card_declined');
    }
    if (this.mode === 'outage') throw new Error('gateway timeout (test)');
    return this.inner.charge(req);
  }
}

export interface TestContext {
  sql: Db;
  app: FastifyInstance;
  notifier: RecordingNotifier;
  gateway: RecordingGateway;
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
  notifier.inner = new PortalNotifier(sql);
  const gateway = new RecordingGateway();
  const app = await buildApp({
    sql,
    identity: new SeededIdentity(sql),
    gateway,
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
    gateway,
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
