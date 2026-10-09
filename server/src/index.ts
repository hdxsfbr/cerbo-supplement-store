// Entrypoint: load config → connect → run migrations (schema, invariants, seeds) → serve.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './app.js';
import { SeededIdentity } from './seams/identity.js';
import { FakePaymentGateway } from './seams/payment.js';
import { PortalNotifier } from './seams/notifier.js';

const config = loadConfig();
const sql = createDb(config.databaseUrl);

const migrated = await runMigrations(sql);
console.log(
  `migrations: ${migrated.applied.length} applied, ${migrated.alreadyApplied.length} already applied`,
);

// In production the API also serves the built SPA from one image (plan.md). Override with STATIC_DIR.
const defaultStaticDir = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../web/dist',
);
const staticDir =
  config.nodeEnv === 'production' ? (process.env.STATIC_DIR ?? defaultStaticDir) : null;

const app = await buildApp({
  sql,
  identity: new SeededIdentity(sql),
  gateway: new FakePaymentGateway(),
  notifier: new PortalNotifier(sql),
  publicWebOrigin: config.publicWebOrigin,
  staticDir,
  logger: { level: config.logLevel },
});

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: '0.0.0.0' });
