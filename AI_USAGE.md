# AI Usage Log

Running log of how AI was used on this take-home, kept as it happens (constitution V). Candor
over polish: this records where AI helped, where it misled, and where a human overrode it.

## Tools

- **Claude Code** (Claude Fable 5.1 driving; Sonnet 5 for any delegated UI subagent) in the
  T3 Code harness — the primary pair for planning docs and implementation.
- **GitHub spec-kit** (`specify init --integration claude`) — `/speckit-constitution`,
  `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`. Artifacts in
  `specs/001-supplement-store/` and `.specify/memory/constitution.md`.
- **Linear** mirror of `tasks.md` (HDX-51…83) for status tracking.

## Summary (read this first)

**What AI did well**

- The whole money core — schema, the deferred constraint trigger, the split function, 20 unit
  cases and 45 integration cases — was written in one sitting with no human-found bugs in the
  invariants. Every adversarial case I could think of (and several the tests invented) is
  rejected by Postgres, not by application code.
- Spec-kit discipline paid off: the spec/plan/data-model/contracts were written before any code,
  then pruned by hand, so implementation was mostly transcription. The task list mapped 1:1 to
  commits and to Linear issues.
- Delegation worked where it was scoped tightly: two Sonnet 5 subagents (design tokens +
  components; patient checkout) each returned green, file-scoped commits that were reviewed and
  cherry-picked. One bug found on review across both (a sign-formatting edge case).
- Verification by driving headless Chrome caught four real UI bugs typecheck could not.

**Where AI misled, and how it was caught**

- Scaffolded GitHub Actions CI while the remote was plainly GitLab. Caught by Andre at the
  Phase 2 review. (Pattern-matching "CI" → GitHub.)
- Seeded patients with an unordered `INSERT … SELECT … JOIN`, so "Zeus King" was id 3. Caught
  by an integration test asserting the demo patient's name.
- `COALESCE(bigint, SUM(bigint))` leaked a numeric → string `"6400"` onto the wire. Caught by a
  test asserting `toBe(6700)`; the BIGINT tripwire only covers oid 20.
- A `vitest` config option in the wrong block; a `noUncheckedIndexedAccess` slip in a test; Vue's
  number-input cast crashing a validator. All caught by typecheck or the headless run.
- One false alarm chased for a few minutes: a "3.0026.50" price looked like a component bug and
  was a puppeteer triple-click not selecting text.

**Where AI went beyond the spec (flagged, not hidden)**

- The DB asserts fee policy and COGS composition, not only the sum (DECISIONS #8).
- The COGS snapshot is taken by a trigger, so the API cannot fabricate it (DECISIONS #9).
- Inventory decrements inside the payment transaction (DECISIONS #12).
- Test DB per file instead of truncation, because the ledger cannot be truncated (DECISIONS #10).

**Where the human overrode or steered**

- GitLab CI instead of GitHub Actions. Hard stops after Phase 2 and Phase 4 before continuing.
  Money code hands-on only, no subagents. Mirror Cerbo's stack (no Nuxt/React/GraphQL/ORM).
  Keep DECISIONS.md and this file current in the moment, not reconstructed.

**Honest limitations**

- The compose/Railway DB role is a superuser, so the `REVOKE` on the ledger is defence in depth
  only; the trigger is the real guard. A separate app role is the production fix.
- GitLab pipelines sat queued with no runner for most of the session (CI steps were run locally
  before every commit). Resolved at the end by assigning the project the same self-hosted Docker
  runner Andre's other GitLab projects use; first run green (check 2 min, integration 42 s).
- The fee policy lives in two places (SQL and TS) on purpose; changing it is a migration plus a
  code change.

## Workflow narrative

1. **Brief → PRD.** Restructured the Gauntlet brief into `docs/PRD.md` with FR-IDs so commits and
   tests trace back to requirements. Captured Cerbo's public Storylane demo as a UI reference
   (`docs/cerbo-ui-reference/`) so the provider surface can look native.
2. **Constitution first.** Six principles; the non-negotiable is integer-cent money with a
   DB-enforced sum invariant and an append-only ledger. Everything downstream is checked against
   it.
3. **Spec → plan → tasks** via spec-kit, each pruned by hand rather than accepted verbatim (the
   generated spec initially duplicated the PRD; it now references it).
4. **Implement** via `/speckit-implement` with hard human stops after Phase 2 (money core) and
   Phase 4 (pay → ledger → audit). Money code is written hands-on by the primary agent, TDD order
   (failing split tests before the split function); only the [P] UI track is delegated.

## Session log

### 2026-10-05 — Phase 1 (scaffold)

- **T001** scaffolded by Claude hands-on: npm workspaces (`server/`, `web/`), Fastify 5 + tsx +
  Vitest, Vite 7 + Vue 3.5 + Pinia 3, shared flat ESLint + Prettier, `.env.example`.
- **AI misstep, caught by tooling:** first `vitest.config.ts` put `fileParallelism` inside a
  per-project block, which the Vitest 3 types reject; typecheck caught it before commit. Also
  pinned `typescript ^5.9` deliberately — the registry's latest is the 7.x native port, too
  new to bet a take-home on.
- **Audit:** `npm audit` flagged `@fastify/static` < 10.1.2 (path traversal advisories); bumped
  to `^10.1.5` before first commit rather than after.
- **Environment quirk (human context AI lacked):** local port 3000 was already bound by an
  unrelated container; `API_PORT` / `WEB_PORT` are env-overridable in compose for that reason.
- **Linear:** the connector was unavailable for the first part of the session, so Phase 1–2
  statuses were pushed in one batch at the Phase 2 stop once it came online; from Phase 3 on they
  move live as tasks start/finish.
- **T002/T003** compose + Makefile + CI written hands-on (small config, not worth a subagent).
  Compose runs the API/web from the `node:22-alpine` image with a bind mount so there is no dev
  Dockerfile to keep in sync; the production multi-stage `Dockerfile` arrives in T024.

### 2026-10-05 — Phase 2 (money core)

- **T004–T007** written hands-on by Claude, no subagents (money code policy). Before writing
  tests, the integrity migration was smoke-tested with a 30-statement psql script covering every
  rejection path (empty send, wrong total, locked items, mismatched sum, wrong fee, 2 entries,
  payment without paid status, 4th entry, UPDATE/DELETE/TRUNCATE on the ledger). All behaved.
- **Where AI went further than the spec, deliberately:** the DB trigger asserts fee policy and
  COGS composition too, not just the sum (DECISIONS #8), and forces the COGS snapshot itself
  (DECISIONS #9). Flagged for Andre at the Phase 2 stop rather than silently shipped.
- **One real misread by the AI, caught by inspection:** in the psql smoke test an "expected
  failure" seemed not to fire. Cause: a prior failed INSERT had consumed an identity value, so
  the test's hard-coded `id = 2` matched nothing. Not a bug in the trigger; re-ran against the
  right id and it rejected correctly. Lesson recorded: never hard-code identity ids in checks.
- **Privilege nuance AI surfaced:** `has_table_privilege` still reports UPDATE/DELETE on the
  ledger because the compose role is a superuser (bypasses ACLs). The ACL itself shows the
  REVOKE took (`arxt`, no `wdD`). The trigger is the real guard; the REVOKE is defence in depth.
- **T009 → T008 TDD:** 20 tests written against the planned interface first (red: module not
  found), then `split.ts`; all green first run. The memo strings were specified in the tests
  before the implementation existed.
- **T010** app factory + seams + integration harness. The harness creates a throwaway DB per
  test file because the ledger cannot be truncated (DECISIONS #10). Typecheck caught one
  `noUncheckedIndexedAccess` slip in a test.
- **Tooling note:** `prettier --check` was red on the T008/T009 commit (4 files) and I only
  noticed after committing; fixed in the T010 commit. CI runs `format:check`, so this would have
  been caught there too.
- **AI misled, human caught it (Phase 2 review):** I scaffolded GitHub Actions CI although
  `git remote -v` plainly shows a GitLab host. The remote was in my context from the first
  minute; I pattern-matched "CI" → GitHub Actions anyway. Andre flagged it; replaced with
  `.gitlab-ci.yml`, constitution patched to 1.0.1 (DECISIONS #11). Lesson: check the hosting
  platform before writing any platform-specific config.

### 2026-10-05 — Phase 3 (US1: provider assembles an order)

- **Split of labour:** server track (T011–T013) hands-on; the [P] UI track (T014: design
  tokens + three components) delegated to one Sonnet 5 agent in an isolated git worktree with a
  file-scoped brief and explicit done-criteria (typecheck/lint/format/build green, commit on its
  branch). Reviewed and merged by the primary agent, not auto-merged.
- **Plan override:** T004 said "camelCase mapping" for DB rows, but the REST contract is
  snake_case. Dropped the transform so DB column, TS row field and JSON key share one name —
  less code, nothing to mis-map. Noted here rather than in DECISIONS (it's plumbing, not design).
- **Two bugs the integration tests caught before any UI existed:**
  1. The seed's `INSERT … SELECT … FROM (VALUES …) JOIN providers` assigned patient ids in
     join order, not list order — Zeus King was id 3, not 1. Fixed with an explicit ordinal +
     `ORDER BY`. Worth knowing: Postgres gives no ordering guarantee for identity assignment
     from an unordered SELECT.
  2. `COALESCE(bigint, SUM(bigint))` is `numeric`, which the client returns as a string, so the
     orders list leaked `"6400"` instead of `6400`. Cast to `::bigint`. The BIGINT tripwire in
     client.ts only covers oid 20; numeric would have silently become a string on the wire.
- **Third catch:** re-sending an already-sent order returned 200 because the DB trigger treats
  `awaiting_payment → awaiting_payment` as a harmless no-op. Route now updates `WHERE status =
  'draft'` and answers 409 on zero rows. The DB stays permissive for idempotent same-state
  writes; the API is strict.
- **T014 review:** the delegated work came back clean (tokens, three components, all checks
  green) with one bug found on review — `formatCents(…, { sign: 'never' })` still printed the
  minus sign. Fixed in a follow-up commit; the agent's commit was cherry-picked as-is so the
  history shows what it produced. Its palette hex values were eyeballed from the screenshots,
  which is the right call given DESIGN-NOTES names colours but gives no swatches.
- **T015/T016 verification method:** the harness's embedded preview browser could not reach
  the local dev server, so I drove headless Chrome with a puppeteer script instead (start
  order → add two lines → override a price → send → screenshot). That caught two real bugs
  (open-orders list not refreshing after creating a draft; stale dev DB from before the seed
  fix) and one false alarm: a "3.0026.50" value that looked like MoneyInput reformatting under
  the cursor. A keystroke trace showed puppeteer's triple-click simply hadn't selected the text;
  with select-all the input behaved. I had already hardened MoneyInput against mid-typing
  reformat (skip the model watcher while focused) before finding that out — kept it, it's
  correct regardless. Screenshots: `docs/screenshots/order-builder-*.png`.
- **Scope call:** spec US1 scenario 2 ("set a margin % instead of a price") was implemented as
  a per-line margin % input that derives the price with integer math rounded up to the cent
  (`priceForMarginBps`). Gross margin is defined on price, before the platform fee.

### 2026-10-05 — Phase 4 (US2: pay → ledger → audit, the graded core)

- **Split of labour:** T017–T019 (pay transaction, ledger route, 23 integration tests) hands-on;
  T020 (patient checkout surface) delegated to one Sonnet 5 agent in a worktree. Its work was
  accepted on review without code changes (one CSS tweak: `min-height: 100vh`). T021 (audit
  view) hands-on.
- **Design choice in the pay route the AI made and I'm flagging:** the order row is locked
  `FOR UPDATE` for the whole pay transaction and the (fake) gateway is called inside it. With a
  real processor you would call the gateway *before* opening the transaction, keyed by the same
  idempotency key, and treat the DB write as the commit point — the comment in `checkout.ts`
  says so. The lock is what makes the 5-way same-key race return five identical 200s instead of
  four unique-violation 409s; the test pins that.
- **Tests caught nothing new this phase — a good sign for Phase 2.** All 23 payment cases,
  including the raw-SQL attacks (mismatched sum, wrong fee, paid-without-ledger, wrong payment
  amount, 4th entry, UPDATE/DELETE/TRUNCATE) passed on first run; the triggers written in T006
  were doing the work. One typing hiccup: porsager's `TransactionSql` is not assignable to `Sql`,
  so the shared loader now takes a `Queryable` union.
- **Self-inflicted detour:** the end-to-end run reported "payment link not valid" — the API
  process I'd started for Phase 3 predated the checkout routes (plain `tsx`, no `watch`).
  Restarting it fixed it; nothing in the code was wrong. Noted so the next person doesn't chase
  a phantom 404.
- **Verified end to end in headless Chrome:** builder → send → patient checkout → pay (with a
  double-click) → reload shows receipt → provider audit shows `BALANCED: $66.00 of $66.00 ✓`
  with the half-cent case on purpose (6600¢ × 75 bps = 49.5¢ → 50¢). Screenshots in
  `docs/screenshots/`.

### 2026-10-05 — Phase 5 (US3: dashboard + inventory)

- Hands-on, no subagents. T022 passed first run: the aggregates are plain `SUM … FILTER` over
  `ledger_entries`, so the reconciliation test (dashboard == Σ per-order audits) is checking a
  structural identity rather than two implementations of the same arithmetic.
- **Bug caught by the headless run, not by typecheck:** Vue casts `<input type="number">`
  v-model values to `number`, so the inline inventory validator crashed on `raw.trim`. TypeScript
  didn't flag it because the editing map was typed as `Record<number, string>` — a true
  statement about my intent and a false one about Vue's behaviour. Normalised with `String()`.
- Low-stock threshold (25) is a constant in `dashboard.ts`; a practice-level setting would be
  the production version. Logged here rather than in DECISIONS since it is a UI heuristic.

### 2026-10-05 — Phase 6 (delivery)

- **T024 image:** multi-stage Dockerfile, 68 MB runtime, non-root, healthcheck. First build
  passed every check except one: checkout links still showed `http://localhost:3000` because an
  earlier Prettier pass had reflowed the config line my scripted edit was matching — the edit
  silently did nothing. Caught by actually curling the container with a forged `Host`. Lesson:
  after a scripted edit, grep for the result, not the absence of an error.
- **T025/T026:** README and this file written hands-on. Cross-checked DECISIONS.md #1–#12
  against what shipped; all current.
- Railway deployment requires Andre's account; the image is verified locally against the
  compose database (health, SPA, history fallback, derived origin).
- **T027 local pass found a real bug the localhost runs had hidden:** `crypto.randomUUID()` is
  undefined outside a secure context, so the patient Pay button threw on the Tailscale URL
  (plain http, non-localhost). The delegated checkout code was correct on `localhost` and would
  have been correct on the https Railway URL — it only broke on the LAN demo. Added a
  `getRandomValues` fallback. Validation against a *different origin than the one you develop
  on* is worth the minute it costs.
- **T024 Railway:** CLI-driven (`init` → `add --database postgres` → `add --service app` with
  a `${{Postgres.DATABASE_URL}}` reference → `up` → `domain`). Two stalls, both billing, neither
  code: the first upload was refused until a payment method was attached, and the Postgres
  service that had been created during the restricted window sat in FAILED and could not be
  redeployed from the CLI — a `serviceInstanceDeploy` GraphQL mutation brought it up, then a
  plain `railway redeploy` of the app succeeded. The app's one crash in between was exactly
  the expected one (`ENOTFOUND postgres.railway.internal`), which is the boot-time migration
  runner refusing to start without a database — the right failure mode.
- **T027 scenario 5:** quickstart scenario 2 was driven headlessly against the public URL; the
  ledger balanced and the derived-origin checkout link pointed at the Railway domain with no
  `PUBLIC_WEB_ORIGIN` configured, as designed.
- **Coverage review (post-delivery):** V8 coverage over `server/src`: money 100/100/100,
  routes 99% lines, orders loader 100%, overall 85% lines. The uncovered remainder is the
  entrypoint, env config, the no-op notifier (tests inject a recording one) and the migration
  runner's CLI/duplicate-number paths. One real finding: the identity seam's `resolveCheckout`
  was dead — checkout routes queried the token directly, bypassing the seam the README
  advertises. Fixed by routing through it. Coverage didn't make the code correct; it caught a
  design promise the code wasn't keeping.

## Post-delivery review (Astra, 2026-10-05)

After the initial delivery, Andre had an independent AI reviewer ("Astra") audit the repo. It
filed twelve Linear tickets (HDX-84…95). I re-verified each against the code before acting.
Status is what actually shipped, not what was planned.

| Ticket | Finding | Verdict | Outcome |
|---|---|---|---|
| HDX-84 | Autosave race: edit during an in-flight PUT was marked saved | **Confirmed** — `dirty = false` after the `else` branch | Fixed: revision-tracked, serialised saves; `send()` flushes first. 4 deterministic tests. |
| HDX-85 | Invalid price text left the order sendable at the old price | Confirmed | Fixed: MoneyInput reports validity; invalid lines block autosave and Send; field error; valid 0 allowed. |
| HDX-86 | Dashboard reads not in one snapshot | Confirmed (ms-wide window) | Fixed: REPEATABLE READ READ ONLY transaction; test commits a payment mid-read. |
| HDX-87 | `TRUNCATE order_items` bypassed the row guard | Confirmed | Fixed: migration 004 BEFORE TRUNCATE triggers + REVOKE on order_items/orders/payments; test. |
| HDX-88 | Gateway inside the DB transaction; no failure tests | Documentation gap, not a defect of the fake | Decline → 402, outage → 502, nothing written; RecordingGateway asserts call counts + rows + stock; README "payment boundary, honestly". Orchestration deliberately unchanged. |
| HDX-89 | Notifier failure after commit → 500, retry → 409 | Confirmed | Fixed: notifier is best-effort; response carries `notified:false`; test. |
| HDX-90 | No frontend tests; `--passWithNoTests` | Fair | Web Vitest suite (31), root `npm test` runs both, flag removed, e2e browser script checked in, test scopes documented. |
| HDX-91 | Stale/overstated docs | Partly valid | Fixed the concrete errors (advisory-lock comment, vitest comment, "proposed" markers, PRD "to come", refund wording, seam "no caller changes" wording); added reviewer path and allocation-vs-accounting note; left the editorial items. |
| HDX-92 | Deliverables: video, GitHub vs GitLab | Human-owned | Video to record; hosting to confirm against the portal form. |
| HDX-93 | Gross vs net margin labels | Valid | Fixed: "Gross margin %" / "Gross line margin" (before fee), "Provider margin (after fee)", line-specific below-cost warning, order-level negative-net-margin warning (verified: at-cost line → −$0.03). |
| HDX-94 | Shared money module | Backlog | Deferred; duplication documented; cross-layer fixed cases now exist in `web/test/money.test.ts`. |
| HDX-95 | Snapshot product name/SKU | Backlog | Deferred; no catalog editing in this slice. |

**What the review taught me.** All four confirmed code bugs were in concurrency or UI state —
the areas with the thinnest tests — while the money core the review hammered hardest came out
clean. The reviewer's reproductions (hold a PUT, commit a payment between reads, TRUNCATE a
table) are exactly the tests I should have written first. Also: two of my own doc comments
described code I had changed since writing them. Comments need the same re-read as code.

Totals after the review pass: 20 + 31 unit, 51 integration, all green; CI green on GitLab.
- **UI copy cleanup (Andre's call, 2026-10-05 evening):** the provider screens carried
  implementation commentary — "(the "email" — notifier stub)", "rounded half-up" footers,
  "COGS + margin + fee = total ✓", "the server confirms the split on save", a column name in a
  label, and inert Medications/Pellets/IVs tabs. I had written those for the reviewer, not the
  provider; Andre read them as placeholder text. Removed; invariant/reconciliation lines now
  render only when they fail. The audit view keeps the fee computation because that is its job.
  Recorded as a standing rule in `~/.claude/CLAUDE.md`: no dev commentary in product UI, and
  clean up any demo scaffolding before reporting done.

### 2026-10-08 — Portal notifications + card form (HDX-96, HDX-97)

- Andre asked how Cerbo actually reaches patients. Checked cer.bo and docs.cer.bo rather than
  guessing: portal with secure messaging and "view and pay bills", API with Secure Messages,
  Patient Emails, Patient Invoices. Built the demo to that shape: the notifier seam now writes
  the two messages a patient would get, a portal page shows them with invoices, and the
  provider's "copy link" became "View as patient".
- Card form with a browser-side fake tokenizer. The design constraint I set myself: the PAN
  must never reach the server even in a demo, so the token carries brand, last4 and the
  Stripe-style test outcome. That let the existing 402/502 gateway paths get real UI.
- Headless run found one layout bug (ZIP field overflowing the card) and the e2e script needed
  to stop treating the expected 402 as a page error. Added a favicon to kill a perennial 404.
- Both features shipped as fake-implementation upgrades behind unchanged seam interfaces
  (DECISIONS #14).

### 2026-10-08 — Demo video

- Produced end to end by the agent, reusing the Chatterbox + cloned-voice setup from
  `~/code/OpenMontage-latest` / `~/code/chatterbox-play` (Andre's own voice reference; no other
  voices). Seven narration scenes written as text, synthesised with Chatterbox Turbo on the local
  GPU, then a puppeteer script screencasts the live Railway app scene by scene, pacing each scene
  to its narration length, with an injected cursor so clicks are visible. ffmpeg assembles stills
  and clips to 1920×1080 at 30 fps. Total 2:56, −17.5 LUFS integrated.
- Two things the first run got wrong: screencasting a static slide produced an empty file (Chrome
  emits no frames without change) — stills are now rendered from PNG; and clicking "View as
  patient" opened a new tab the recorder wasn't watching — the script navigates instead.
- What the agent cannot judge: pronunciation. Andre reviews the narration by ear before use.

### 2026-10-08 — KEY_METRICS.md, ARCHITECTURE.md, SCALING.md

- Andre asked for proper metrics and architecture docs and a 10 → 100 000-user scaling
  analysis, and whether Cerbo is multi-tenant. Checked docs.cer.bo: the API is addressed as
  `https://{tenant}.md-hq.com/api/v1/` with per-practice credentials; whether tenants are
  separate instances or one routed app is not public (their security page 404s), so SCALING.md
  treats both and recommends a hybrid with `practice_id` everywhere.
- KEY_METRICS.md is honest about what is *not* measurable here: "volume migrated off third-party
  marketplaces" needs a baseline the system never sees; decline/replay rates need a
  `payment_attempts` table that doesn't exist yet.
- ARCHITECTURE.md moved to the repo root and gained request flows, source-of-truth table,
  consistency model, security/privacy, tenancy and operability sections.

### 2026-10-09 — Chart replica and the embedded Rx-style supplement flow

- Built `/experimental-chart` from Cerbo's Storylane screenshots, first as a static replica, then
  with a Supplements tab plus "+ Add Supplement" picker and "+ Complete Supplement Order" modals
  copied from Cerbo's Rx flow. Andre approved the static modals before anything was wired.
- Wiring reused the order-draft store instead of new state; the only server change is an
  optional `sig` column (migration 007) with contract, tests and the checkout view updated.
- Verified with a headless-Chrome run of the whole flow (search, pick, edit sig/price, add two
  lines, reopen a draft line to check prefill, send) and the API read-back of the saved sig.
- Agent judgment call that Andre should confirm: pharmacy-only fields from the Rx form (refills,
  days supply, protocol select, print) were removed instead of shown as inert controls.

### 2026-10-09 — Sign-in, patient-portal replica, and wiring the portal to the store

- Built `/experimental-portal` from seven Cerbo portal screenshots (static first, approved,
  then wired), a root sign-in with two doctors and two patients, and a patient dropdown on the
  chart in place of Cerbo's search box.
- Wiring added one endpoint (`POST /api/portal/session`) on the identity seam and extended the
  portal view with items, card and payment method; tests, contract and DECISIONS #16 updated.
- Verified in headless Chrome: sign in as Zeus, read messages, Make Payment → existing checkout
  with a test Visa → back to the portal with balance, statement credit and card tile updated.
- Judgment calls to confirm: My Supplements lists what the practice ordered (paid or not, with a
  Pay Now button on unpaid lines); Cerbo's self-reported supplement lookup stays static.

### 2026-10-09 — Supplement list vs. orders, and patient requests

- Andre spotted that the chart's Supplements tab mixed the clinical list with order lines.
  The agent proposed the split in DECISIONS #17 (list table, orders from selected rows,
  patient requests gated by the provider); Andre approved it and asked for a clean refactor.
- Removed: the chart's in-place pricing modal and its use of the order-draft store, the
  draft store's `setSig`, the static supplement data, and the CSS those left behind.
- Added migration 008, provider list/request routes, portal self-add/request endpoints, and an
  8-test integration file covering add, duplicate, cross-provider denial, order-from-list,
  request → fulfil, and decline → message. Verified the full loop in headless Chrome.

### 2026-10-09 — One header for chart and store

- Extracted the chart's Cerbo header into `CerboNav.vue` and routed every provider page through
  it; the store's own nav bar, the "Acting as" switcher and the seeded-provider list are gone.
  The login store is now the only thing that sets the acting provider on the identity seam.
- A regression caught in the browser pass: the store pages' centered width lived in App.vue's
  scoped styles and vanished with the old nav; moved to `cerbo.css`.
- The end-to-end script and the demo recorder sign in first now that provider pages are gated.
