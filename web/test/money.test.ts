import { describe, expect, it } from 'vitest';
import {
  formatBps,
  formatCents,
  marginPercentBps,
  parseCentsInput,
  previewSplit,
  priceForMarginBps,
} from '../src/money';

describe('formatCents', () => {
  it('formats integer cents as dollars', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(1)).toBe('$0.01');
    expect(formatCents(3200)).toBe('$32.00');
    expect(formatCents(-508)).toBe('-$5.08');
    expect(formatCents(-508, { parens: true })).toBe('($5.08)');
    expect(formatCents(-508, { sign: 'never' })).toBe('$5.08');
    expect(formatCents(508, { sign: 'always' })).toBe('+$5.08');
  });
  it('refuses non-integers', () => {
    expect(() => formatCents(1.5)).toThrow(RangeError);
  });
});

describe('parseCentsInput', () => {
  it.each([
    ['32', 3200],
    ['32.5', 3250],
    ['32.50', 3250],
    ['$1,234.56', 123456],
    [' 0.01 ', 1],
    ['.5', 50],
    ['32.', 3200],
    ['0', 0],
  ])('%s → %d', (text, cents) => {
    expect(parseCentsInput(text)).toBe(cents);
  });
  it.each(['', 'abc', '1.234', '-5', '+5', '1.2.3', '1e3'])('%s → null', (text) => {
    expect(parseCentsInput(text)).toBeNull();
  });
});

describe('previewSplit mirrors the server policy on fixed cases', () => {
  // Expected values are hand-computed, not derived from either implementation.
  it.each([
    [
      [
        { quantity: 2, unit_price_cents: 3200, unit_cogs_cents: 1850 },
        { quantity: 1, unit_price_cents: 300, unit_cogs_cents: 400 },
      ],
      6700,
      4100,
      50,
      2550,
    ],
    [[{ quantity: 1, unit_price_cents: 200, unit_cogs_cents: 100 }], 200, 100, 2, 98], // 1.5¢ → 2¢
    [[{ quantity: 1, unit_price_cents: 134, unit_cogs_cents: 1 }], 134, 1, 1, 132], // 1.005¢ → 1¢
    [[{ quantity: 1, unit_price_cents: 1, unit_cogs_cents: 1 }], 1, 1, 0, 0],
    [[{ quantity: 1, unit_price_cents: 1000, unit_cogs_cents: 1500 }], 1000, 1500, 8, -508],
    [[], 0, 0, 0, 0],
  ])('case %#', (items, total, cogs, fee, margin) => {
    expect(previewSplit(items)).toEqual({
      total_cents: total,
      cogs_cents: cogs,
      fee_cents: fee,
      margin_cents: margin,
    });
  });
});

describe('priceForMarginBps (gross margin on price, before fee)', () => {
  it('derives a price that meets or exceeds the target margin, rounded up to the cent', () => {
    // 40% on 1600¢ COGS → 1600 / 0.6 = 2666.67 → 2667
    expect(priceForMarginBps(1600, 4000)).toBe(2667);
    expect(marginPercentBps(2667, 2667 - 1600)).toBeGreaterThanOrEqual(4000);
    expect(priceForMarginBps(1850, 0)).toBe(1850); // 0% → at cost
    expect(priceForMarginBps(1000, 5000)).toBe(2000); // 50% → exactly double
  });
  it('rejects 100% or more and bad input', () => {
    expect(priceForMarginBps(1000, 10000)).toBeNull();
    expect(priceForMarginBps(-1, 100)).toBeNull();
  });
});

describe('marginPercentBps / formatBps', () => {
  it('reports gross margin as bps of price and formats to one decimal', () => {
    expect(marginPercentBps(0, 0)).toBeNull();
    expect(marginPercentBps(6600, 2450)).toBe(3712);
    expect(formatBps(3712)).toBe('37.1%');
    expect(formatBps(-43333)).toBe('-433.3%');
  });
});
