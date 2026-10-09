// Card-entry helpers for the (fake) checkout form (HDX-97). Formatting, Luhn, brand detection,
// expiry validation, and a *fake tokenizer*: the card number never leaves the browser; the
// server receives `fake_tok_<brand>_<last4>_<outcome>` where outcome follows Stripe's test cards.

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export function detectBrand(number: string): CardBrand {
  const d = digitsOnly(number);
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^6(011|5)/.test(d)) return 'discover';
  return 'unknown';
}

export function brandLabel(b: CardBrand | string | null | undefined): string {
  switch (b) {
    case 'visa':
      return 'Visa';
    case 'mastercard':
      return 'Mastercard';
    case 'amex':
      return 'American Express';
    case 'discover':
      return 'Discover';
    default:
      return 'Card';
  }
}

/** Groups digits 4-4-4-4 (Amex 4-6-5). */
export function formatCardNumber(input: string): string {
  const d = digitsOnly(input).slice(0, detectBrand(input) === 'amex' ? 15 : 16);
  if (detectBrand(d) === 'amex') {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  }
  return d.match(/.{1,4}/g)?.join(' ') ?? '';
}

export function luhnValid(number: string): boolean {
  const d = digitsOnly(number);
  if (d.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function cardNumberValid(number: string): boolean {
  const d = digitsOnly(number);
  const len = detectBrand(d) === 'amex' ? 15 : 16;
  return d.length === len && luhnValid(d);
}

/** "MM/YY" → formatted as typed; validates month and that the card has not expired. */
export function formatExpiry(input: string): string {
  const d = digitsOnly(input).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function expiryValid(input: string, now: Date = new Date()): boolean {
  const d = digitsOnly(input);
  if (d.length !== 4) return false;
  const month = Number(d.slice(0, 2));
  const year = 2000 + Number(d.slice(2));
  if (month < 1 || month > 12) return false;
  const endOfMonth = new Date(year, month, 0, 23, 59, 59); // last day of that month
  return endOfMonth >= now;
}

export function cvcValid(cvc: string, brand: CardBrand): boolean {
  const d = digitsOnly(cvc);
  return brand === 'amex' ? d.length === 4 : d.length === 3;
}

export function zipValid(zip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(zip.trim());
}

export type TestOutcome = 'ok' | 'declined' | 'error';

/** Stripe-style test numbers decide the fake outcome; everything else succeeds. */
export function testOutcome(number: string): TestOutcome {
  const d = digitsOnly(number);
  if (d === '4000000000000002') return 'declined';
  if (d === '4000000000000119') return 'error';
  return 'ok';
}

export interface FakePaymentMethod {
  token: string;
  brand: string;
  last4: string;
}

/** The only thing that leaves the browser. */
export function tokenize(number: string): FakePaymentMethod {
  const d = digitsOnly(number);
  const brand = detectBrand(d);
  const last4 = d.slice(-4);
  return { token: `fake_tok_${brand}_${last4}_${testOutcome(d)}`, brand, last4 };
}

export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', label: 'Succeeds' },
  { number: '4000 0000 0000 0002', label: 'Declined' },
  { number: '4000 0000 0000 0119', label: 'Processing error' },
] as const;
