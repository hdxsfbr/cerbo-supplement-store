// Fastify app factory. Pure function of its dependencies so tests can build it against a
// throwaway database with the fake seams, and index.ts can build it for real.

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { ZodType } from 'zod';
import type { Db } from './db/client.js';
import { migrationStatus } from './db/migrate.js';
import { HttpError, mapDbError } from './errors.js';
import { ACTING_PROVIDER_HEADER, type IdentityProvider, type Provider } from './seams/identity.js';
import type { PaymentGateway } from './seams/payment.js';
import type { Notifier } from './seams/notifier.js';
import { catalogRoutes } from './routes/catalog.js';
import { patientsRoutes } from './routes/patients.js';
import { ordersRoutes } from './routes/orders.js';
import { checkoutRoutes } from './routes/checkout.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { portalRoutes } from './routes/portal.js';

export interface AppDeps {
  sql: Db;
  identity: IdentityProvider;
  gateway: PaymentGateway;
  notifier: Notifier;
  /** Origin used to build patient checkout URLs (the "email" content). '' = use request Host. */
  publicWebOrigin: string;
  /** Directory of the built SPA to serve (production single-image mode); null = API only. */
  staticDir?: string | null;
  logger?: boolean | { level: string };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

/** Validate with Zod; failures become 400 validation_error. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
      .join('; ');
    throw new HttpError(400, 'validation_error', detail);
  }
  return result.data;
}

/** The acting provider for a provider-facing route (identity seam). 401 if unresolvable. */
export async function requireProvider(req: FastifyRequest): Promise<Provider> {
  const raw = req.headers[ACTING_PROVIDER_HEADER];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;
  const provider = await req.server.deps.identity.resolveProvider(headerValue);
  if (!provider) throw new HttpError(401, 'unknown_provider', 'No such acting provider');
  return provider;
}

/** Public origin for links we hand to patients: configured value, else the request's own origin. */
export function publicOrigin(req: FastifyRequest): string {
  const configured = req.server.deps.publicWebOrigin;
  if (configured) return configured;
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol;
  const host =
    (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

/** Parse a positive-integer route param. */
export function idParam(value: string, label = 'id'): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n <= 0) {
    throw new HttpError(400, 'validation_error', `${label} must be a positive integer`);
  }
  return n;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  app.decorate('deps', deps);

  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });

  // ── Error envelope ────────────────────────────────────────────────────────────────────────
  app.setErrorHandler((rawErr, req, reply) => {
    const err = mapDbError(rawErr);
    if (err instanceof HttpError) {
      if (err.statusCode >= 500) req.log.error({ err: rawErr }, err.code);
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const fast = err as { statusCode?: number; code?: string; message?: string };
    if (fast.code === 'FST_ERR_VALIDATION' || fast.statusCode === 400) {
      return reply
        .status(400)
        .send({ error: { code: 'validation_error', message: fast.message ?? 'Bad request' } });
    }
    if (fast.statusCode === 415 || fast.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply
        .status(415)
        .send({ error: { code: 'unsupported_media_type', message: 'Send application/json' } });
    }
    req.log.error({ err: rawErr }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });

  // ── Health ────────────────────────────────────────────────────────────────────────────────
  app.get('/api/health', async () => {
    const migrations = await migrationStatus(deps.sql);
    return { ok: true, migrations };
  });

  // ── Feature routes ────────────────────────────────────────────────────────────────────────
  await app.register(catalogRoutes);
  await app.register(patientsRoutes);
  await app.register(ordersRoutes);
  await app.register(checkoutRoutes);
  await app.register(dashboardRoutes);
  await app.register(portalRoutes);

  // ── Static SPA (production single image) + 404 envelope ──────────────────────────────────
  const staticDir = deps.staticDir ?? null;
  if (staticDir) {
    await access(path.join(staticDir, 'index.html')); // fail fast if the build is missing
    await app.register(fastifyStatic, { root: staticDir, wildcard: false, index: false });
  }
  app.setNotFoundHandler(async (req, reply) => {
    if (staticDir && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.sendFile('index.html'); // SPA client-side routing fallback
    }
    return reply
      .status(404)
      .send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` } });
  });

  return app;
}
