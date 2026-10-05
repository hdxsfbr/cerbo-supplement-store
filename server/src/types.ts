// Shared server types. All money is integer cents (constitution I). Field names ending in
// `Cents` are the TS mirror of DB columns ending in `_cents`.

export type Cents = number;

export type OrderStatus = 'draft' | 'awaiting_payment' | 'paid';

export type LedgerEntryType = 'cogs' | 'provider_margin' | 'platform_fee';

export interface ApiError {
  error: { code: string; message: string };
}
