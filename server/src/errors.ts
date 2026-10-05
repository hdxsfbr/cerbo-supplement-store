// HTTP error type + mapping of database rejections to API error codes.
// Error envelope on the wire: { error: { code, message } } (contracts/api.md).

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const orderLocked = (message = 'Order is no longer editable') =>
  new HttpError(409, 'order_locked', message);

interface PgErrorLike {
  code?: string;
  message?: string;
  constraint_name?: string;
}

/**
 * Translate Postgres errors — in particular the custom SQLSTATEs raised by 002_integrity.sql —
 * into HttpErrors. Anything unrecognised is returned unchanged (→ 500).
 *
 *   CB001 ledger append-only       → 500 ledger_immutable   (never reachable through the API)
 *   CB002 split invariant          → 500 split_invariant    (the DB refused a bad split — a bug)
 *   CB003 order locked / frozen    → 409 order_locked
 *   CB004 order has no items       → 422 order_empty
 *   23505 unique_violation         → 409 (payments.order_id → already_paid; else conflict)
 */
export function mapDbError(err: unknown): unknown {
  const e = err as PgErrorLike;
  if (!e || typeof e !== 'object' || typeof e.code !== 'string') return err;
  switch (e.code) {
    case 'CB001':
      return new HttpError(500, 'ledger_immutable', e.message ?? 'ledger is append-only');
    case 'CB002':
      return new HttpError(500, 'split_invariant', e.message ?? 'split invariant violated');
    case 'CB003':
      return new HttpError(409, 'order_locked', e.message ?? 'order is locked');
    case 'CB004':
      return new HttpError(422, 'order_empty', e.message ?? 'order has no items');
    case '23505':
      if (e.constraint_name === 'payments_order_id_key') {
        return new HttpError(409, 'already_paid', 'Order has already been paid');
      }
      return new HttpError(409, 'conflict', e.message ?? 'conflict');
    case '23503':
      return new HttpError(422, 'invalid_reference', e.message ?? 'referenced row does not exist');
    case '23514':
      return new HttpError(422, 'check_violation', e.message ?? 'constraint violated');
    default:
      return err;
  }
}
