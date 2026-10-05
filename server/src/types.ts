// Shared server types. All money is integer cents (constitution I). DB columns, TS row fields
// and JSON wire fields share one snake_case name; money fields end in `_cents`.

export type Cents = number;

export type OrderStatus = 'draft' | 'awaiting_payment' | 'paid';

export type LedgerEntryType = 'cogs' | 'provider_margin' | 'platform_fee';

export interface ApiError {
  error: { code: string; message: string };
}
