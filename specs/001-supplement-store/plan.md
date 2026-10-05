# Implementation Plan: In-House Supplement Store

**Branch**: `001-supplement-store` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-supplement-store/spec.md`

## Summary

A provider assembles a supplement order for a patient (order-line pricing, COGS snapshotted),
the patient pays through a stubbed payment seam, and the system persists an append-only,
DB-enforced money split (COGS + provider margin + 75 bps platform fee, integer cents), surfaced
through an audit view and a provider dashboard. Built as a Vue 3 SPA + Fastify REST API +
Postgres monorepo mirroring Cerbo's stack, deployed as a single Docker image.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22 LTS (server and web)

**Primary Dependencies**: Fastify 5 (REST API), Vue 3.5 + Vite 6 + Pinia (SPA), `postgres`
(porsager) as thin Postgres client, Zod for request validation

**Storage**: PostgreSQL 16 — raw SQL migrations (plain `.sql` files applied by a small runner),
no ORM on money paths

**Testing**: Vitest — unit (money math), integration against real Postgres (dockerized) for the
split invariant, idempotency, and lifecycle rules

**Target Platform**: Linux/Docker; local dev via docker-compose, public deploy on Railway (API +
static SPA served by Fastify from one image, managed Postgres)

**Project Type**: Web application (SPA + REST API monorepo)

**Performance Goals**: Demo-scale; instant-feel UI (<200ms API responses locally); no load
targets per brief

**Constraints**: Integer cents everywhere; ledger append-only with DB-enforced sum invariant;
all external boundaries (payment, EHR identity, email, shipping) stubbed behind documented seams;
1–2 day time box

**Scale/Scope**: ~7 tables, ~12 REST endpoints, 3 screens (order builder, patient checkout,
dashboard) + audit view; seed data ≈ 2 providers, 6 patients, 8 supplements

## Constitution Check

*GATE: evaluated against constitution v1.0.0 before Phase 0; re-checked after Phase 1.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Money correctness | PASS | Integer cents; fee = half-up via integer arithmetic; append-only ledger; deferred constraint trigger enforces sum invariant at DB level; edge-case test suite planned first |
| II. Mirror partner stack | PASS | Vue 3 + TS, Fastify + TS, Postgres, Docker; no React/Nuxt/GraphQL; `postgres` client is a driver, not an ORM — SQL stays visible |
| III. Clean seams | PASS | `PaymentGateway`, `IdentityProvider` (EHR seam), `Notifier` (email) defined as interfaces with fake implementations; each documented in code and README |
| IV. Pragmatic scope | PASS | 3 screens, seeded catalog, no auth UI, no refunds; cuts logged in DECISIONS.md |
| V. Decisions documented | PASS | DECISIONS.md #1–#7 current; AI_USAGE.md starts with scaffold commit |
| VI. Two design languages | PASS | Provider screens per docs/cerbo-ui-reference/DESIGN-NOTES.md; patient checkout in clean portal style; plain CSS tokens, no UI framework |

**Post-Phase-1 re-check**: PASS — no violations introduced by the design; Complexity Tracking
empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-supplement-store/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.md           # REST endpoint contracts
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
server/
├── src/
│   ├── app.ts               # Fastify app factory (also serves web/dist in prod)
│   ├── index.ts             # entrypoint
│   ├── db/
│   │   ├── client.ts        # postgres client, integer-cent helpers
│   │   ├── migrate.ts       # tiny SQL migration runner
│   │   └── migrations/      # 00X_*.sql (schema, invariant trigger, seeds)
│   ├── money/
│   │   └── split.ts         # fee + split computation (pure, integer cents)
│   ├── seams/
│   │   ├── payment.ts       # PaymentGateway interface + FakePaymentGateway
│   │   ├── identity.ts      # IdentityProvider interface + SeededIdentity (EHR seam)
│   │   └── notifier.ts      # Notifier interface + NoopNotifier (email stub)
│   ├── routes/
│   │   ├── catalog.ts       # supplements + inventory
│   │   ├── orders.ts        # assemble, send, audit
│   │   ├── checkout.ts      # patient view + pay (idempotent)
│   │   └── dashboard.ts     # aggregates
│   └── types.ts
└── test/
    ├── split.test.ts        # money math unit tests (edge cases)
    └── integration/         # invariant, idempotency, lifecycle vs real Postgres

web/
├── src/
│   ├── main.ts / App.vue / router.ts
│   ├── stores/              # Pinia: session (acting provider), order draft
│   ├── views/
│   │   ├── OrderBuilder.vue # provider, Cerbo chart idiom
│   │   ├── Checkout.vue     # patient, portal style
│   │   ├── Dashboard.vue    # provider, Cerbo billing idiom
│   │   └── OrderAudit.vue   # cent-by-cent split
│   ├── components/          # CerboPanel, LedgerTable, MoneyInput, SplitPreview
│   └── styles/              # cerbo.css (provider tokens), portal.css (patient)
└── test/                    # component smoke tests (minimal per constitution IV)

docker-compose.yml           # postgres + server (tsx watch) + web (vite)
Dockerfile                   # multi-stage: build web, build server, single runtime image
.gitlab-ci.yml               # lint, typecheck, tests (with Postgres service)
```

**Structure Decision**: Web application layout with `server/` and `web/` at the repo root —
matches the SPA + REST shape of Cerbo's own architecture and keeps the money core (`server/src/
money`, `server/src/db`) isolated from transport and UI.

## Complexity Tracking

No constitution violations to justify.
