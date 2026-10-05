// The money split — pure, integer-cent arithmetic. No floats anywhere (constitution I).
//
//   totalCents  = Σ quantity × unitPriceCents          (what the patient pays)
//   cogsCents   = Σ quantity × unitCogsCents           (snapshotted cost basis)
//   feeCents    = floor((totalCents × 75 + 5000) / 10000)   75 bps of the total, half-up
//   marginCents = totalCents − cogsCents − feeCents    (residual ⇒ the sum is exact by construction)
//
// The same fee formula is re-asserted by the database at commit (002_integrity.sql §2f), so if
// this file and the DB ever disagree, the payment transaction fails rather than mis-splitting.
// Policy rationale: DECISIONS.md #4. Edge cases pinned in test/split.test.ts.

import type { Cents, LedgerEntryType } from '../types.js';

export const PLATFORM_FEE_BPS = 75;
const BPS_DENOMINATOR = 10_000;

export interface SplitItem {
  quantity: number;
  unitPriceCents: Cents;
  unitCogsCents: Cents;
}

export interface Split {
  totalCents: Cents;
  cogsCents: Cents;
  feeCents: Cents;
  marginCents: Cents;
  /** Human-readable computation notes, persisted on ledger_entries.memo for the audit view. */
  memos: Record<LedgerEntryType, string>;
}

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${label} must be a non-negative safe integer number of cents (got ${value})`,
    );
  }
}

function assertSafe(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} overflowed Number.isSafeInteger (got ${value})`);
  }
}

/** 75 bps of `totalCents`, rounded half-up, in integer arithmetic. */
export function platformFeeCents(totalCents: Cents): Cents {
  assertCents(totalCents, 'totalCents');
  const scaled = totalCents * PLATFORM_FEE_BPS;
  assertSafe(scaled, 'totalCents × fee bps');
  return Math.floor((scaled + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

/** Exact decimal rendering of (totalCents × bps / 10000) without floats, e.g. "54.375". */
export function exactFeeDecimal(totalCents: Cents): string {
  const scaled = totalCents * PLATFORM_FEE_BPS;
  const whole = Math.floor(scaled / BPS_DENOMINATOR);
  const frac = scaled % BPS_DENOMINATOR;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(4, '0').replace(/0+$/, '')}`;
}

export function computeSplit(items: readonly SplitItem[]): Split {
  let totalCents = 0;
  let cogsCents = 0;
  const cogsTerms: string[] = [];

  for (const [i, item] of items.entries()) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new RangeError(
        `items[${i}].quantity must be a positive integer (got ${item.quantity})`,
      );
    }
    assertCents(item.unitPriceCents, `items[${i}].unitPriceCents`);
    assertCents(item.unitCogsCents, `items[${i}].unitCogsCents`);

    const lineTotal = item.quantity * item.unitPriceCents;
    const lineCogs = item.quantity * item.unitCogsCents;
    assertSafe(lineTotal, `items[${i}] line total`);
    assertSafe(lineCogs, `items[${i}] line COGS`);

    totalCents += lineTotal;
    cogsCents += lineCogs;
    assertSafe(totalCents, 'running total');
    assertSafe(cogsCents, 'running COGS');
    cogsTerms.push(`${item.quantity}×${item.unitCogsCents}¢`);
  }

  const feeCents = platformFeeCents(totalCents);
  const marginCents = totalCents - cogsCents - feeCents;
  assertSafe(marginCents, 'marginCents');

  const memos: Split['memos'] = {
    platform_fee: `${PLATFORM_FEE_BPS} bps of ${totalCents}¢ = ${exactFeeDecimal(totalCents)}¢ → ${feeCents}¢ (half-up)`,
    cogs: `Σ quantity × unit COGS snapshot: ${cogsTerms.length ? cogsTerms.join(' + ') : '(no items)'} = ${cogsCents}¢`,
    provider_margin:
      `residual: ${totalCents}¢ − ${cogsCents}¢ COGS − ${feeCents}¢ fee = ${marginCents}¢` +
      (marginCents < 0 ? ' (negative: priced below COGS)' : ''),
  };

  return { totalCents, cogsCents, feeCents, marginCents, memos };
}
