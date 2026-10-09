# Key Metrics

What this product should be measured on, how each number is derived from the data model, and
what we can already report. Money metrics come from `ledger_entries` so they reconcile with the
per-order audit by construction (SC-004).

## 1. Business metrics (the brief's "impact")

| Metric | Definition | Derivation | Status |
|---|---|---|---|
| **GMV processed in-house** (headline) | Σ amount paid on paid orders, per period | `SUM(payments.amount_cents)` = `SUM(ledger_entries.amount_cents)` for paid orders | Shipped: dashboard "Gross sales" tile, per provider |
| **Platform fee revenue** | Σ 75 bps fee entries | `SUM(amount_cents) WHERE entry_type='platform_fee'` | Shipped: "Platform fees" tile |
| **Provider margin paid out** | Σ margin entries | `… WHERE entry_type='provider_margin'` | Shipped: "Provider margin" tile |
| **COGS** | Σ snapshotted cost of sold units | `… WHERE entry_type='cogs'` | Shipped: "Cost of goods" tile |
| **Take rate** | fee ÷ GMV | derived from the two sums above; should be 0.75% ± rounding | Computable; not displayed |
| **Volume migrated off third-party marketplaces** (leading indicator) | orders that would previously have gone to Fullscript et al. | requires a baseline per practice (prior marketplace volume) that does not exist in this system | **Not measurable here**; needs practice onboarding data or marketplace export |
| **Active providers** | providers with ≥1 paid order in period | `COUNT(DISTINCT provider_id)` over paid orders | Computable; not displayed |
| **Orders per active provider per month** | adoption depth | paid orders ÷ active providers | Computable |
| **Average order value** | GMV ÷ paid orders | | Computable |
| **Realised gross margin %** | Σ margin ÷ GMV | | Shipped: "% of gross" under the margin tile |

## 2. Funnel and experience metrics

| Metric | Definition | Derivation | Status |
|---|---|---|---|
| **Send → pay conversion** | paid ÷ sent orders | `orders.status` counts | Computable from `orders` |
| **Time to pay** | `paid_at − sent_at` median / p90 | timestamps on `orders` | Computable |
| **Abandoned orders** | awaiting_payment older than N days | `sent_at` age | Computable; no expiry policy yet |
| **Decline rate** | declined pay attempts ÷ attempts | attempts are **not persisted** (402s are not rows) | Needs a `payment_attempts` table or structured log counting |
| **Replay rate** | same-key pay requests after success | not persisted | Log counting |
| **Time to assemble** (SC-003: < 2 min) | `sent_at − created_at` | timestamps on `orders` | Computable; measured by hand in the demo (~40 s) |
| **Below-cost lines** | lines with price < COGS | `order_items` | Computable; UI warns at assembly |

## 3. Integrity metrics (should always be zero)

| Metric | Definition | How verified |
|---|---|---|
| **Split drift** | paid orders where Σ ledger ≠ amount paid | impossible to commit (deferred trigger); audit view would show "OUT OF BALANCE" |
| **Dashboard reconciliation error** | tiles − Σ per-order audits | structurally zero (same rows); reconciliation banner renders only on mismatch |
| **Duplicate payments** | orders with > 1 payment | `payments.order_id UNIQUE` |
| **Ledger mutations** | UPDATE/DELETE/TRUNCATE on `ledger_entries` | trigger + REVOKE; tested |
| **Fee policy mismatch** | fee ≠ ⌊(total×75+5000)/10000⌋ | asserted at commit; tested with fixed cases on client, server and SQL |

## 4. Engineering and operational metrics

| Metric | Current value | Source |
|---|---|---|
| Unit tests | 20 server + 37 web | `npm test` |
| Integration tests (real Postgres) | 60 | `npm run test:integration` |
| Server line coverage | ~85% (money module 100%, routes 99%) | `npm run test:coverage -w server` |
| CI pipeline | check ≈ 2 min, integration ≈ 40 s, deploy ≈ 1.5 min | GitLab CI |
| Deploy frequency | every push to `main` | GitLab → Railway |
| API latency (local, unloaded) | < 50 ms for all routes | not instrumented; see SCALING.md |
| Error budget signals | 5xx rate, `split_invariant` (CB002) occurrences, `payment_gateway_error` rate | logged; not aggregated yet |

## 5. What to instrument next

1. **Payment attempts table** (`order_id`, key, outcome, gateway code, latency) → decline rate,
   replay rate, gateway p95.
2. **Request metrics** (route, status, latency histogram) via a pino → OpenTelemetry exporter.
3. **Daily rollup** of the ledger per provider/day for the dashboard once it stops being cheap to
   sum (SCALING.md, tier 3).
4. **Practice baseline capture at onboarding** (previous marketplace monthly volume) so "volume
   migrated" becomes a real number instead of a story.
