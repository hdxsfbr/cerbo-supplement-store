// ─── SEAM: identity / EHR ──────────────────────────────────────────────────────────────────────
// WHAT IS FAKED: who the acting provider is, which patient a checkout link belongs to, and
//   which patient a portal link belongs to (patients.portal_token stands in for a portal login).
// WHERE THE SEAM IS: this interface. Routes only ever call `resolveProvider` / `resolveCheckout`.
// WHAT PRODUCTION WOULD DO: `resolveProvider` would read the EHR session (Cerbo's logged-in user)
//   and `resolveCheckout` would be backed by the patient-portal session or a signed, expiring
//   link. Here, provider identity comes from an `x-acting-provider: <id>` header (defaulting to
//   the first seeded provider) and the checkout token is a random capability token stored on the
//   order (orders.checkout_token). See DECISIONS.md #1, FR-011.

import type { Db } from '../db/client.js';

export interface Provider {
  id: number;
  name: string;
  npi: string | null;
}

export interface CheckoutIdentity {
  orderId: number;
  patient: { id: number; name: string; email: string | null };
}

export interface PortalIdentity {
  patient: { id: number; name: string; email: string | null };
  provider: { id: number; name: string };
}

export interface IdentityProvider {
  /** Who is acting. `headerValue` is the raw `x-acting-provider` header, if any. */
  resolveProvider(headerValue: string | undefined): Promise<Provider | null>;
  /** Which order (and patient) a checkout capability token grants access to. */
  resolveCheckout(token: string): Promise<CheckoutIdentity | null>;
  /** Which patient a portal capability token belongs to (stand-in for the portal login). */
  resolvePortal(token: string): Promise<PortalIdentity | null>;
}

export const ACTING_PROVIDER_HEADER = 'x-acting-provider';

export class SeededIdentity implements IdentityProvider {
  constructor(private readonly sql: Db) {}

  async resolveProvider(headerValue: string | undefined): Promise<Provider | null> {
    if (headerValue === undefined || headerValue === '') {
      const [first] = await this.sql<Provider[]>`
        SELECT id, name, npi FROM providers ORDER BY id LIMIT 1`;
      return first ?? null;
    }
    const id = Number(headerValue);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const [row] = await this.sql<Provider[]>`SELECT id, name, npi FROM providers WHERE id = ${id}`;
    return row ?? null;
  }

  async resolveCheckout(token: string): Promise<CheckoutIdentity | null> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
    const [row] = await this.sql<
      { order_id: number; patient_id: number; patient_name: string; patient_email: string | null }[]
    >`
      SELECT o.id AS order_id, p.id AS patient_id, p.name AS patient_name, p.email AS patient_email
      FROM orders o JOIN patients p ON p.id = o.patient_id
      WHERE o.checkout_token = ${token}`;
    if (!row) return null;
    return {
      orderId: row.order_id,
      patient: { id: row.patient_id, name: row.patient_name, email: row.patient_email },
    };
  }

  async resolvePortal(token: string): Promise<PortalIdentity | null> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
    const [row] = await this.sql<
      {
        id: number;
        name: string;
        email: string | null;
        provider_id: number;
        provider_name: string;
      }[]
    >`
      SELECT p.id, p.name, p.email, pr.id AS provider_id, pr.name AS provider_name
      FROM patients p JOIN providers pr ON pr.id = p.provider_id
      WHERE p.portal_token = ${token}`;
    if (!row) return null;
    return {
      patient: { id: row.id, name: row.name, email: row.email },
      provider: { id: row.provider_id, name: row.provider_name },
    };
  }
}
