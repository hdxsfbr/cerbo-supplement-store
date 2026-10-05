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
