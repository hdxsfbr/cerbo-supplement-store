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
- **Linear:** the Linear MCP connector is not exposed in this session, so status updates are
  batched for the human at each hard stop instead of being pushed live.
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
