# Demo video — title, description, thumbnail

**File:** `out/cerbo-supplement-store-demo-v1.1.mp4` (4:17) · **Thumbnail:** `out/thumbnail.png` (1280×720, from `slides/thumb.html`)

## Title

Cerbo Supplement Store — an in-house store inside the chart and patient portal (Vue · Fastify · Postgres)

## Description

A take-home for Cerbo: a vertical slice of an in-house supplement store, built in Cerbo's own stack
(Vue 3, TypeScript, Fastify, PostgreSQL) and placed where a provider would expect it — a Supplements
tab in the patient chart and the patient's own portal.

What you'll see (4 min):
0:00 Why — where every cent goes: COGS + provider margin + Cerbo's 75 bps fee = what the patient paid
0:32 Chart — the patient's supplement list, Cerbo-style picker and directions, create an order from it
1:04 Order — default prices, target margin → price, the live split, send to the patient
1:39 Portal — Secure Messages → Pay Now; a declined card, then a good one; refresh = still one payment; the patient requests a refill
2:24 The request lands on the chart; the provider prices it and sends
2:37 Audit — three ledger entries with their memos; a half-cent fee rounding half-up; the sum invariant enforced by Postgres at commit
3:13 Orders list and the sales report that sums the ledger; drop-ship fulfilment
3:33 Under the hood and what's deliberately out of scope

Live demo: https://app-production-500d.up.railway.app (sign in as welby@demo.cer.bo or zeus@olympus.example — demo login, no password)
Repository: https://labs.gauntletai.com/andrebatista/cerbo-supplement-store
Docs in the repo: README · ARCHITECTURE.md · DECISIONS.md · AI_USAGE.md · INTEGRATION_PLAN.md

Money is integer cents end to end; the ledger is append-only; a deferred constraint trigger re-checks the split at commit; 70 integration tests run against a real Postgres in CI. Payments, identity and messaging are behind documented seams with fakes — nothing is charged.

Narrated in a cloned voice (Chatterbox); the recording is scripted and regenerable from docs/demo.
