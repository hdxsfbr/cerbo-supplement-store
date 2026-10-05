# Tasks: In-House Supplement Store

**Input**: Design documents from `/specs/001-supplement-store/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Included for money paths only, per constitution I & IV (test-first on split math and
DB invariants; no UI test theater).

**Organization**: Grouped by user story. Task IDs are stable and mirrored to Linear project
"Cerbo Supplement Store" (team HDX).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Scaffold monorepo: root package.json (npm workspaces), server/ (Fastify+TS+tsx+Vitest) and web/ (Vite+Vue3+TS+Pinia) packages, shared tsconfig/eslint/prettier, .gitignore, .env.example
- [X] T002 [P] docker-compose.yml: postgres:16 (cerbo_store db, healthcheck), server (tsx watch, depends_on db), web (vite dev); Makefile/npm scripts for up/test
- [X] T003 [P] GitHub Actions CI in .github/workflows/ci.yml: typecheck, lint, unit tests, integration tests against a Postgres service container

## Phase 2: Foundational (money core — blocks all stories)

- [X] T004 Migration runner in server/src/db/migrate.ts (applies server/src/db/migrations/*.sql in order, records in schema_migrations; runs on boot) + db client in server/src/db/client.ts (porsager postgres, camelCase mapping)
- [X] T005 Migration 001_schema.sql: providers, patients, supplements (unit_cogs_cents, default_price_cents, inventory_count), orders (status CHECK draft/awaiting_payment/paid, checkout_token UNIQUE, total_cents), order_items (unit_cogs_cents snapshot, unit_price_cents CHECK >= 0, quantity CHECK > 0), payments (order_id UNIQUE, idempotency_key UNIQUE), ledger_entries (entry_type CHECK cogs/provider_margin/platform_fee, UNIQUE(order_id, entry_type), memo) — all money BIGINT cents per data-model.md
- [X] T006 Migration 002_integrity.sql: append-only ledger (REVOKE UPDATE/DELETE + raise trigger), deferred constraint trigger asserting per-paid-order SUM(amount_cents) = orders.total_cents and exactly one entry per type, trigger freezing order financial fields after draft
- [X] T007 [P] Migration 003_seed.sql: 2 providers (Dr. Marcus Welby, Dr. Sarah Anderson), 6 Greek-god patients, 8 supplements with COGS $4–$38, default prices ~30–60% margin, inventory 20–200
- [ ] T008 Pure split function in server/src/money/split.ts: totals from items, feeCents = floor((total*75+5000)/10000), margin as residual; Number.isSafeInteger guards; returns memo strings for ledger
- [ ] T009 [P] Unit tests in server/test/split.test.ts: sum-invariant property over randomized items, $0.01 order (fee 0), half-cent fee boundary rounds up, negative margin, zero/empty guards — written against T008's interface, must fail before T008 lands (TDD)
- [ ] T010 Fastify app factory in server/src/app.ts + server/src/index.ts: /api/health, error envelope {error:{code,message}}, static serving of web/dist in prod; seams in server/src/seams/: identity.ts (x-acting-provider header → seeded provider; checkout token → patient), payment.ts (PaymentGateway iface + FakePaymentGateway honoring idempotency_key), notifier.ts (Notifier iface + NoopNotifier logging checkout URL)

## Phase 3: User Story 1 — Provider assembles an order (P1)

**Goal**: Provider picks patient, adds supplements (default price pre-filled, overridable),
sees live split preview, sends order. **Independent test**: spec US1 acceptance scenarios via
API + UI; order locked after send.

- [ ] T011 [US1] Routes in server/src/routes/catalog.ts (GET /api/supplements) and server/src/routes/patients.ts (GET /api/patients for acting provider) per contracts/api.md
- [ ] T012 [US1] Routes in server/src/routes/orders.ts: POST /api/orders, PUT /api/orders/:id/items (snapshots COGS, 409 unless draft), GET /api/orders/:id (with live split preview via T008), POST /api/orders/:id/send (422 if empty; freezes total; returns checkout_url), GET /api/orders list
- [ ] T013 [US1] Integration tests in server/test/integration/orders.test.ts: draft→awaiting_payment flow, COGS snapshot immune to catalog change, item mutation on sent order → 409 order_locked, empty send → 422
- [ ] T014 [P] [US1] Cerbo design tokens in web/src/styles/cerbo.css per docs/cerbo-ui-reference/DESIGN-NOTES.md (panel-header palette, dense zebra tables, red charges, chart chrome) + shared components web/src/components/CerboPanel.vue, MoneyInput.vue (cents-safe), SplitPreview.vue
- [ ] T015 [US1] web/src/ app shell: router.ts (provider routes + /pay/:token), stores/session.ts (acting provider), stores/orderDraft.ts, api client web/src/api.ts (cents passthrough, error envelope)
- [ ] T016 [US1] OrderBuilder.vue in web/src/views/: patient picker, supplement add with default-price pre-fill + per-line override, below-COGS warning, live split preview, send → shows checkout URL (Notifier stub surface)

## Phase 4: User Story 2 — Patient pays, split recorded (P1)

**Goal**: Checkout by capability token; pay transactionally writes payment + 3 ledger entries;
audit view shows every cent. **Independent test**: contract invariants 1–4 in contracts/api.md.

- [ ] T017 [US2] Routes in server/src/routes/checkout.ts: GET /api/checkout/:token (order view / receipt shape if paid), POST /api/checkout/:token/pay — single transaction: validate amount = total, insert payment (idempotency replay returns original 200; different key on paid order → 409 already_paid), order → paid, insert 3 ledger entries from T008 with memos
- [ ] T018 [US2] Route GET /api/orders/:id/ledger in server/src/routes/orders.ts: entries + fee computation inputs (total, 75 bps, rounding memo); 409 if not paid
- [ ] T019 [US2] Integration tests in server/test/integration/payment.test.ts: invariant holds on paid order, double-pay same key (one payment row, same response), different key → 409, direct SQL attempt at 4th ledger entry / mismatched sum / UPDATE ledger_entries rejected by DB
- [ ] T020 [P] [US2] Patient surface: web/src/styles/portal.css (clean portal look) + Checkout.vue in web/src/views/ (items, total, Pay button with client-generated idempotency key, receipt state)
- [ ] T021 [US2] OrderAudit.vue in web/src/views/: cent-by-cent ledger table (Cerbo billing-block idiom: dated rows, red charges, bold balance), fee memo display; linked from OrderBuilder/Dashboard

## Phase 5: User Story 3 — Dashboard: sales & inventory (P2)

**Goal**: Aggregates reconcile structurally with ledger; inventory editable. **Independent
test**: spec US3 scenarios; contract invariant 5.

- [ ] T022 [US3] Route GET /api/dashboard/summary in server/src/routes/dashboard.ts (sums over ledger_entries; low/negative inventory flags) + PATCH /api/supplements/:id/inventory in catalog.ts; reconciliation integration test in server/test/integration/dashboard.test.ts (summary = Σ per-order ledgers)
- [ ] T023 [US3] Dashboard.vue in web/src/views/: gross/margin/fees/orders tiles, paid-orders table with drill-in to OrderAudit, inventory table with inline edit + negative-stock flag, styled per Cerbo billing idiom

## Phase 6: Polish & Delivery

- [ ] T024 Multi-stage Dockerfile (build web → build server → single runtime image serving SPA + API, migrations on boot) and deploy to Railway with managed Postgres; verify /api/health and quickstart scenario 2 on the public URL
- [ ] T025 [P] README.md rewrite: run instructions (quickstart), architecture sketch, stubbed-seams table (what's fake, where the seam is, what production would do), assumptions; conflict-of-interest transparency paragraph (DECISIONS.md #7)
- [ ] T026 [P] AI_USAGE.md: tools used, what worked / misled / was overridden, spec-kit workflow narrative; cross-check DECISIONS.md is current through implementation
- [ ] T027 Full quickstart.md validation pass (scenarios 1–5) against local + deployed; fix gaps; record results in quickstart.md

## Dependencies

- Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 (phase-gated)
- T009 (failing tests) lands before/with T008 per TDD on money math; T008 blocks T012/T017
- T005/T006 block all route work; T010 blocks all routes; T014/T015 block T016/T020/T021/T023
- US1 (Phase 3) is independently demoable; US2 completes the graded core; US3 reads what US1+US2 wrote

## Parallel Opportunities

- Phase 1: T002, T003 parallel after T001
- Phase 2: T007, T009 parallel with T004–T006 track
- Phase 3: T014 (styles/components) parallel with T011–T013 (server track)
- Phase 4: T020 parallel with T017–T019
- Phase 6: T025, T026 parallel with T024

## Implementation Strategy

MVP = Phases 1–4 (US1 + US2): that alone satisfies PRD FR-1…FR-4 and the graded money core.
Phase 5 adds FR-5; Phase 6 is submission packaging. If the time box bites, cut from the tail of
Phase 5's UI polish, never from Phase 2/4 tests.

## Linear Mirror

Project: https://linear.app/hdxsfbr/project/cerbo-supplement-store-0b2dcdcc9405 (team HDX).
Phase parents (blocking chain HDX-51 → … → HDX-56): Phase 1 = HDX-51, Phase 2 = HDX-52,
Phase 3 = HDX-53, Phase 4 = HDX-54, Phase 5 = HDX-55, Phase 6 = HDX-56.
Tasks map sequentially: T001–T003 → HDX-57–59 · T004–T010 → HDX-60–66 · T011–T016 → HDX-67–72 ·
T017–T021 → HDX-73–77 · T022–T023 → HDX-78–79 · T024–T027 → HDX-80–83.
Statuses are updated in Linear as tasks start/finish; this file's checkboxes remain the
source of truth for /speckit-implement.
