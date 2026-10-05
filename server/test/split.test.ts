// Money-math unit tests — written BEFORE server/src/money/split.ts (TDD, constitution I).
// Pins the fee policy (75 bps of the order total, half-up, integer arithmetic), the sum
// invariant, and the input guards. No DB, no Fastify.

import { describe, expect, it } from 'vitest';
import {
  PLATFORM_FEE_BPS,
  computeSplit,
  platformFeeCents,
  type SplitItem,
} from '../src/money/split.js';

const item = (quantity: number, unitPriceCents: number, unitCogsCents: number): SplitItem => ({
  quantity,
  unitPriceCents,
  unitCogsCents,
});

describe('platformFeeCents — 75 bps, half-up', () => {
  it('exposes the rate as 75 bps', () => {
    expect(PLATFORM_FEE_BPS).toBe(75);
  });

  it('is zero on a zero total', () => {
    expect(platformFeeCents(0)).toBe(0);
  });

  it('rounds a one-cent order to a zero fee (0.0075¢)', () => {
    expect(platformFeeCents(1)).toBe(0);
  });

  it('rounds exactly-half-cent fees UP (half-up policy)', () => {
    // 200¢ × 75 / 10000 = 1.5¢ → 2¢ ; 600¢ → 4.5¢ → 5¢ ; 1000¢ → 7.5¢ → 8¢
    expect(platformFeeCents(200)).toBe(2);
    expect(platformFeeCents(600)).toBe(5);
    expect(platformFeeCents(1000)).toBe(8);
  });

  it('rounds just-under-half down and just-over-half up', () => {
    expect(platformFeeCents(66)).toBe(0); // 0.495¢
    expect(platformFeeCents(67)).toBe(1); // 0.5025¢
    expect(platformFeeCents(133)).toBe(1); // 0.9975¢
    expect(platformFeeCents(134)).toBe(1); // 1.005¢  (spec edge case: $1.34)
    expect(platformFeeCents(13400)).toBe(101); // 100.5¢ → 101¢ (data-model memo example)
  });

  it('matches the exact fee on whole-dollar multiples of $400 (fee is an integer there)', () => {
    // 40000¢ × 0.0075 = 300¢ exactly — no rounding involved.
    expect(platformFeeCents(40_000)).toBe(300);
    expect(platformFeeCents(80_000)).toBe(600);
  });

  it('is monotonic non-decreasing in the total', () => {
    let prev = platformFeeCents(0);
    for (let total = 1; total <= 20_000; total++) {
      const fee = platformFeeCents(total);
      expect(fee).toBeGreaterThanOrEqual(prev);
      expect(fee - prev).toBeLessThanOrEqual(1);
      prev = fee;
    }
  });

  it('rejects non-integer, negative and unsafe totals', () => {
    expect(() => platformFeeCents(1.5)).toThrow(RangeError);
    expect(() => platformFeeCents(-1)).toThrow(RangeError);
    expect(() => platformFeeCents(Number.NaN)).toThrow(RangeError);
    expect(() => platformFeeCents(Number.MAX_SAFE_INTEGER)).toThrow(RangeError); // ×75 overflows
  });
});

describe('computeSplit — COGS + provider margin + platform fee == total', () => {
  it('splits a simple two-line order', () => {
    // 2 × 3200 + 1 × 850 = 7250 total; COGS 2 × 1850 + 400 = 4100; fee 54.375 → 54; margin residual
    const split = computeSplit([item(2, 3200, 1850), item(1, 850, 400)]);
    expect(split).toMatchObject({
      totalCents: 7250,
      cogsCents: 4100,
      feeCents: 54,
      marginCents: 3096,
    });
    expect(split.cogsCents + split.marginCents + split.feeCents).toBe(split.totalCents);
  });

  it('handles a one-cent order: fee 0, split is COGS + margin only', () => {
    const split = computeSplit([item(1, 1, 1)]);
    expect(split).toMatchObject({ totalCents: 1, cogsCents: 1, feeCents: 0, marginCents: 0 });
  });

  it('handles a half-cent fee boundary inside a multi-item order', () => {
    // total 600 → fee 4.5¢ → 5¢
    const split = computeSplit([item(3, 100, 40), item(1, 300, 100)]);
    expect(split).toMatchObject({ totalCents: 600, cogsCents: 220, feeCents: 5, marginCents: 375 });
  });

  it('allows a negative provider margin when priced below COGS; fee still applies', () => {
    const split = computeSplit([item(1, 1000, 1500)]);
    expect(split.totalCents).toBe(1000);
    expect(split.feeCents).toBe(8);
    expect(split.marginCents).toBe(-508);
    expect(split.cogsCents + split.marginCents + split.feeCents).toBe(1000);
  });

  it('returns an all-zero split for an empty item list (draft preview), not an error', () => {
    expect(computeSplit([])).toMatchObject({ totalCents: 0, cogsCents: 0, feeCents: 0, marginCents: 0 });
  });

  it('allows zero-priced lines (free item) — fee and margin follow', () => {
    const split = computeSplit([item(2, 0, 500)]);
    expect(split).toMatchObject({ totalCents: 0, cogsCents: 1000, feeCents: 0, marginCents: -1000 });
  });

  it('never silently coerces bad input', () => {
    expect(() => computeSplit([item(0, 100, 50)])).toThrow(RangeError); // quantity must be > 0
    expect(() => computeSplit([item(-1, 100, 50)])).toThrow(RangeError);
    expect(() => computeSplit([item(1.5, 100, 50)])).toThrow(RangeError);
    expect(() => computeSplit([item(1, -100, 50)])).toThrow(RangeError); // price >= 0
    expect(() => computeSplit([item(1, 100, -50)])).toThrow(RangeError); // cogs >= 0
    expect(() => computeSplit([item(1, 10.5, 5)])).toThrow(RangeError); // no fractional cents
    expect(() => computeSplit([item(1, 100, Number.NaN)])).toThrow(RangeError);
    expect(() => computeSplit([item(1, Number.MAX_SAFE_INTEGER, 0), item(1, 1, 0)])).toThrow(RangeError);
  });

  it('exposes human-readable memos showing the computation (audit view, FR-006)', () => {
    const split = computeSplit([item(2, 3200, 1850), item(1, 850, 400)]);
    expect(split.memos.platform_fee).toBe('75 bps of 7250¢ = 54.375¢ → 54¢ (half-up)');
    expect(split.memos.cogs).toBe('Σ quantity × unit COGS snapshot: 2×1850¢ + 1×400¢ = 4100¢');
    expect(split.memos.provider_margin).toBe('residual: 7250¢ − 4100¢ COGS − 54¢ fee = 3096¢');
  });

  it('memo spells out the half-up rounding on an exact half cent', () => {
    expect(computeSplit([item(1, 200, 100)]).memos.platform_fee).toBe(
      '75 bps of 200¢ = 1.5¢ → 2¢ (half-up)',
    );
  });

  it('memo flags a negative margin', () => {
    expect(computeSplit([item(1, 1000, 1500)]).memos.provider_margin).toMatch(/negative/i);
  });

  it('property: sum invariant holds for randomized multi-item orders (seeded PRNG)', () => {
    // Deterministic LCG so a failure is reproducible from the seed.
    let seed = 0x5eed_c0de;
    const rnd = (max: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % (max + 1);
    };
    for (let run = 0; run < 5_000; run++) {
      const items: SplitItem[] = [];
      const lines = 1 + rnd(5);
      for (let i = 0; i < lines; i++) {
        items.push(item(1 + rnd(9), rnd(20_000), rnd(20_000)));
      }
      const split = computeSplit(items);
      const expectedTotal = items.reduce((s, it) => s + it.quantity * it.unitPriceCents, 0);
      const expectedCogs = items.reduce((s, it) => s + it.quantity * it.unitCogsCents, 0);
      expect(split.totalCents).toBe(expectedTotal);
      expect(split.cogsCents).toBe(expectedCogs);
      expect(split.feeCents).toBe(platformFeeCents(expectedTotal));
      expect(split.cogsCents + split.marginCents + split.feeCents).toBe(split.totalCents);
      expect(Number.isSafeInteger(split.marginCents)).toBe(true);
    }
  });

  it('property: fee error vs exact rational is at most half a cent', () => {
    for (let total = 0; total <= 50_000; total += 7) {
      const exactTimes10000 = total * 75; // exact fee × 10000
      const fee = platformFeeCents(total);
      // |fee×10000 − exact| ≤ 5000, i.e. within half a cent, with ties going up.
      const diff = fee * 10_000 - exactTimes10000;
      expect(diff).toBeGreaterThanOrEqual(-4_999);
      expect(diff).toBeLessThanOrEqual(5_000);
    }
  });
});
