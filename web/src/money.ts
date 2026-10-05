// Cents formatting/parsing helpers for the web client (T014).
//
// Constitution I: all money is integer cents, no floats. Every function here operates on
// Number.isSafeInteger cent values using integer math (Math.trunc / % / string splitting) —
// never parseFloat-style multiplication, which can introduce binary rounding error.

export interface FormatCentsOptions {
  /** 'auto' (default) only shows a sign for negative values, 'always' also shows '+', 'never' shows the magnitude only. */
  sign?: 'auto' | 'always' | 'never';
  /** Render negatives as "($5.08)" instead of "-$5.08". */
  parens?: boolean;
}

/** Formats an integer cents value as a dollar string, e.g. 3200 -> "$32.00", -508 -> "-$5.08". */
export function formatCents(cents: number, opts: FormatCentsOptions = {}): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`formatCents: cents must be a safe integer (got ${cents})`);
  }
  const { sign = 'auto', parens = false } = opts;
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  const magnitude = `$${dollars}.${remainder}`;

  if (isNegative) {
    if (parens) return `(${magnitude})`;
    return `-${magnitude}`;
  }
  if (sign === 'always') return `+${magnitude}`;
  return magnitude;
}

/**
 * Parses a user-typed dollar string (e.g. "32", "32.5", "32.50", "$1,234.56", " 0.01 ") into
 * integer cents. Pure string handling — no parseFloat multiplication. Returns null for invalid
 * input: empty, non-numeric characters, more than one decimal point, a negative sign (prices are
 * never negative here), or more than two fractional digits (rejected, not rounded).
 */
export function parseCentsInput(text: string): number | null {
  let trimmed = text.trim();
  if (trimmed === '') return null;

  // Strip an optional leading '$' and any thousands-separator commas.
  if (trimmed.startsWith('$')) trimmed = trimmed.slice(1);
  trimmed = trimmed.replace(/,/g, '');
  if (trimmed === '') return null;

  // Reject anything that isn't plain digits with at most one decimal point and at most two
  // fractional digits. (No sign allowed — negative prices are never valid.)
  const match = /^(\d+)(?:\.(\d{0,2}))?$|^\.(\d{1,2})$/.exec(trimmed);
  if (!match) return null;

  const wholePart = match[1] ?? '0';
  const fracPartRaw = match[2] ?? match[3] ?? '';
  const fracPart = fracPartRaw.padEnd(2, '0');

  const whole = Number(wholePart);
  const frac = Number(fracPart);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(frac)) return null;

  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cerbo's platform fee, in basis points of the order total. Mirrors server/src/money/split.ts. */
export const PLATFORM_FEE_BPS = 75;
const BPS_DENOMINATOR = 10_000;

export interface SplitPreviewItem {
  quantity: number;
  unit_price_cents: number;
  unit_cogs_cents: number;
}

export interface SplitPreviewResult {
  total_cents: number;
  cogs_cents: number;
  fee_cents: number;
  margin_cents: number;
}

/**
 * Client-side MIRROR of the money split formula, for instant UI preview only.
 * The server (server/src/money/split.ts) and the database trigger (002_integrity.sql) are the
 * only authoritative computations — this exists purely so the order builder can show a live
 * estimate before the request round-trips. Never use this result to record money.
 */
export function previewSplit(items: SplitPreviewItem[]): SplitPreviewResult {
  let total_cents = 0;
  let cogs_cents = 0;

  for (const item of items) {
    total_cents += item.quantity * item.unit_price_cents;
    cogs_cents += item.quantity * item.unit_cogs_cents;
  }

  const fee_cents = Math.floor((total_cents * PLATFORM_FEE_BPS + 5000) / BPS_DENOMINATOR);
  const margin_cents = total_cents - cogs_cents - fee_cents;

  return { total_cents, cogs_cents, fee_cents, margin_cents };
}

/** Margin as basis points of total (display only — Math.round is fine here). Null when total is 0. */
export function marginPercentBps(total_cents: number, margin_cents: number): number | null {
  if (total_cents === 0) return null;
  return Math.round((margin_cents / total_cents) * BPS_DENOMINATOR);
}

/** Formats a basis-points value (10000 bps = 100%) as a one-decimal percentage, e.g. 4230 -> "42.3%". */
export function formatBps(bps: number): string {
  const tenths = Math.round(bps / 10); // tenths of a percentage point
  const sign = tenths < 0 ? '-' : '';
  const absTenths = Math.abs(tenths);
  const whole = Math.trunc(absTenths / 10);
  const decimal = absTenths % 10;
  return `${sign}${whole}.${decimal}%`;
}
