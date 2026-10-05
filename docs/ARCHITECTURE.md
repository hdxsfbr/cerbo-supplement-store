# Architecture

Vertical slice of an in-house supplement store that "lives inside" Cerbo's EHR. One Vue 3 SPA
with two visual surfaces, one Fastify REST API, one Postgres database that is the system of record
for money. Everything external is behind a documented seam with a fake implementation.

## System overview

![System overview](architecture/overview.png)

```mermaid
flowchart LR
  classDef surface fill:#f7f7f2,stroke:#555,color:#111
  classDef api fill:#eef3fb,stroke:#2b4c7e,color:#111
  classDef money fill:#fff4e5,stroke:#b35c00,color:#111,stroke-width:2px
  classDef seam fill:#f3eefb,stroke:#6b3fa0,color:#111,stroke-dasharray:5 3
  classDef ext fill:#ffffff,stroke:#999,color:#666,stroke-dasharray:2 2
  classDef db fill:#e8f5e9,stroke:#2e7d32,color:#111

  subgraph Browser["Browser — Vue 3 SPA (web/)"]
    direction TB
    subgraph Provider["Provider surface · cerbo.css (Cerbo chart idiom)"]
      OB[OrderBuilder.vue]
      DA[Dashboard.vue]
      AU[OrderAudit.vue]
    end
    subgraph Patient["Patient surface · portal.css"]
      CK["Checkout.vue<br/>/pay/:token"]
    end
    ST["Pinia stores<br/>session · orderDraft"]
    API_C["api.ts<br/>integer cents passthrough"]
  end
  class OB,DA,AU,CK,ST,API_C surface

  subgraph Server["Fastify API (server/)"]
    direction TB
    APP["app.ts<br/>error envelope · SQLSTATE→HTTP map<br/>serves web/dist in prod"]
    subgraph Routes["routes/"]
      R1["catalog.ts<br/>GET /supplements · PATCH inventory"]
      R2["patients.ts<br/>GET /patients"]
      R3["orders.ts<br/>create · items · send · ledger · list"]
      R4["checkout.ts<br/>GET /checkout/:token · POST pay"]
      R5["dashboard.ts<br/>GET /summary"]
    end
    SPLIT["money/split.ts<br/>fee = ⌊(total×75+5000)/10000⌋<br/>margin = total − COGS − fee"]
    MIG["db/migrate.ts<br/>runs *.sql on boot"]
  end
  class APP,R1,R2,R3,R4,R5,MIG api
  class SPLIT money

  subgraph Seams["seams/ — interfaces with fakes (constitution III)"]
    direction TB
    ID["IdentityProvider<br/>SeededIdentity<br/>x-acting-provider header · checkout token"]
    PG["PaymentGateway<br/>FakePaymentGateway<br/>auto-succeeds, honours idempotency key"]
    NT["Notifier<br/>NoopNotifier<br/>logs checkout URL"]
  end
  class ID,PG,NT seam

  EHR["Cerbo EHR session<br/>/ patient portal"]:::ext
  STRIPE["Payment processor"]:::ext
  MAIL["Email / portal queue"]:::ext

  subgraph DB["PostgreSQL 16 — system of record"]
    direction TB
    T1[("providers · patients<br/>supplements")]
    T2[("orders → order_items<br/>(COGS snapshot)")]
    T3[("payments<br/>order_id UNIQUE · key UNIQUE")]
    T4[("ledger_entries<br/>APPEND-ONLY")]
    TRG["002_integrity.sql triggers<br/>• deferred: Σ entries = total, 1 per type,<br/>  fee = 75 bps half-up, COGS = Σ snapshot<br/>• lifecycle freeze draft→awaiting→paid<br/>• items locked unless draft"]
  end
  class T1,T2,T3,T4 db
  class TRG money

  API_C -- "JSON · /api/*" --> APP
  APP --> Routes
  R3 & R4 --> SPLIT
  Routes --> ID
  R4 --> PG
  R3 --> NT
  Routes -- "SQL (porsager postgres)" --> DB
  MIG --> DB
  ID -.->|production| EHR
  PG -.->|production| STRIPE
  NT -.->|production| MAIL
```

## The money path (US2: patient pays)

One request, one database transaction, verified at commit by the database itself.

![Pay sequence](architecture/pay-sequence.png)

```mermaid
sequenceDiagram
  autonumber
  actor P as Patient (Checkout.vue)
  participant API as checkout.ts
  participant GW as PaymentGateway (fake)
  participant SP as money/split.ts
  participant DB as Postgres (deferred triggers)

  P->>API: POST /api/checkout/:token/pay { idempotency_key }
  API->>DB: resolve token → order (status awaiting_payment, total_cents)
  alt key already used for this order
    DB-->>API: existing payment row
    API-->>P: 200 — original receipt (replay)
  else order already paid with a different key
    API-->>P: 409 already_paid
  else first payment
    API->>GW: charge({ amount = total_cents, idempotency_key })
    GW-->>API: { succeeded, gateway_ref }
    API->>SP: computeSplit(items with COGS snapshot)
    SP-->>API: { cogs, margin, fee, memos }   fee half-up, margin residual
    API->>DB: BEGIN
    API->>DB: INSERT payments (order_id UNIQUE)
    API->>DB: UPDATE orders SET status='paid'
    API->>DB: INSERT ledger_entries ×3 (cogs, provider_margin, platform_fee + memos)
    API->>DB: UPDATE supplements.inventory_count −= qty
    API->>DB: COMMIT
    Note over DB: deferred constraint trigger assert_order_split():<br/>3 entries · Σ = total_cents · one payment of equal amount ·<br/>COGS = Σ snapshot · fee = ⌊(total×75+5000)/10000⌋ — else ROLLBACK
    DB-->>API: committed
    API-->>P: 200 — receipt (items, total)
  end
```

## Order lifecycle (enforced by `orders_guard_transition`)

![Order lifecycle](architecture/lifecycle.png)

```mermaid
stateDiagram-v2
  [*] --> draft : POST /orders
  draft --> draft : PUT /items (re-snapshots COGS)
  draft --> awaiting_payment : POST /send\n≥1 item · total frozen · checkout URL issued
  awaiting_payment --> paid : POST /checkout/:token/pay\npayment + 3 ledger entries, same tx
  paid --> [*]
  note right of awaiting_payment
    items locked (409 order_locked)
    total_cents immutable
  end note
  note right of paid
    row immutable
    ledger append-only
  end note
```

## Deployment

![Deployment](architecture/deployment.png)

```mermaid
flowchart LR
  classDef box fill:#f7f7f2,stroke:#555,color:#111
  DEV["docker compose<br/>db · server (tsx watch) · web (vite)"]:::box
  CI["GitLab CI<br/>check: typecheck · lint · unit · build<br/>integration: Vitest vs postgres:16 service"]:::box
  IMG["Multi-stage Dockerfile<br/>build web → build server →<br/>one runtime image: Fastify serves /api + web/dist"]:::box
  RW["Railway service"]:::box
  RPG[("Railway Postgres")]:::box
  DEV --> CI --> IMG --> RW
  RW -- "migrations on boot" --> RPG
```

## Where things live

| Concern | Location |
|---|---|
| Fee policy (75 bps half-up) | `server/src/money/split.ts` **and** `002_integrity.sql` §2f (cross-check, DECISIONS #8) |
| Sum invariant | `002_integrity.sql` `assert_order_split()` — deferred constraint trigger |
| Append-only ledger | `002_integrity.sql` §1 — trigger + REVOKE |
| COGS snapshot | `order_items_guard` trigger copies from catalog on insert (DECISIONS #9) |
| Stubbed boundaries | `server/src/seams/*.ts` — header comment on each states what is faked and what production does |
| Provider look | `web/src/styles/cerbo.css` per `docs/cerbo-ui-reference/DESIGN-NOTES.md` |
| Patient look | `web/src/styles/portal.css` |

PNGs are rendered from the Mermaid blocks above with `@mermaid-js/mermaid-cli`; the Mermaid source is canonical.
