import { describe, expect, it } from 'vitest';
import {
  cardNumberValid,
  cvcValid,
  detectBrand,
  expiryValid,
  formatCardNumber,
  formatExpiry,
  luhnValid,
  testOutcome,
  tokenize,
  zipValid,
} from '../src/card';

describe('card helpers', () => {
  it('detects brands', () => {
    expect(detectBrand('4242424242424242')).toBe('visa');
    expect(detectBrand('5555555555554444')).toBe('mastercard');
    expect(detectBrand('2223003122003222')).toBe('mastercard');
    expect(detectBrand('378282246310005')).toBe('amex');
    expect(detectBrand('6011111111111117')).toBe('discover');
    expect(detectBrand('1234')).toBe('unknown');
  });
  it('formats numbers in groups (amex 4-6-5)', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('42424')).toBe('4242 4');
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
    expect(formatCardNumber('4242424242424242999')).toBe('4242 4242 4242 4242'); // truncates
  });
  it('Luhn + length', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(cardNumberValid('4242 4242 4242 4242')).toBe(true);
    expect(cardNumberValid('4242 4242 4242 424')).toBe(false);
    expect(cardNumberValid('3782 822463 10005')).toBe(true);
    expect(cardNumberValid('4000 0000 0000 0002')).toBe(true); // declined card is still a valid number
  });
  it('expiry', () => {
    const now = new Date(2026, 9, 8); // 2026-10-08
    expect(formatExpiry('1229')).toBe('12/29');
    expect(formatExpiry('12')).toBe('12');
    expect(expiryValid('12/29', now)).toBe(true);
    expect(expiryValid('10/26', now)).toBe(true); // expires end of this month
    expect(expiryValid('09/26', now)).toBe(false);
    expect(expiryValid('13/29', now)).toBe(false);
    expect(expiryValid('1/29', now)).toBe(false);
  });
  it('cvc and zip', () => {
    expect(cvcValid('123', 'visa')).toBe(true);
    expect(cvcValid('1234', 'visa')).toBe(false);
    expect(cvcValid('1234', 'amex')).toBe(true);
    expect(zipValid('94105')).toBe(true);
    expect(zipValid('94105-1234')).toBe(true);
    expect(zipValid('9410')).toBe(false);
  });
  it('fake tokenizer never includes the PAN and encodes the test outcome', () => {
    expect(tokenize('4242 4242 4242 4242')).toEqual({
      token: 'fake_tok_visa_4242_ok',
      brand: 'visa',
      last4: '4242',
    });
    expect(tokenize('4000 0000 0000 0002').token).toBe('fake_tok_visa_0002_declined');
    expect(tokenize('4000 0000 0000 0119').token).toBe('fake_tok_visa_0119_error');
    expect(testOutcome('5555555555554444')).toBe('ok');
    expect(JSON.stringify(tokenize('4242424242424242'))).not.toContain('4242424242424242');
  });
});
