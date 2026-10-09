// Typed API client. Cents pass straight through as integers; the server's error envelope
// { error: { code, message } } becomes an ApiError. The acting-provider header is the identity
// seam's stand-in for an EHR session (contracts/api.md).

import type {
  CheckoutView,
  DashboardSummary,
  InventoryView,
  LedgerView,
  OrderLineInput,
  OrderListRow,
  OrderView,
  Patient,
  PaymentMethodInput,
  PortalView,
  Supplement,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

let actingProviderId: number | null = null;
export function setActingProvider(id: number | null): void {
  actingProviderId = id;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (actingProviderId !== null) headers['x-acting-provider'] = String(actingProviderId);

  let res: Response;
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    res = await fetch(`${BASE}${path}`, init);
  } catch (err) {
    throw new ApiError(0, 'network_error', (err as Error).message);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, 'bad_response', `Non-JSON response (${res.status})`);
  }
  if (!res.ok) {
    const env = json as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      res.status,
      env?.error?.code ?? 'http_error',
      env?.error?.message ?? `HTTP ${res.status}`,
    );
  }
  return json as T;
}

export const api = {
  health: () =>
    request<{ ok: boolean; migrations: { applied: number; latest: string | null } }>(
      'GET',
      '/api/health',
    ),

  supplements: () => request<{ supplements: Supplement[] }>('GET', '/api/supplements'),
  patients: () =>
    request<{ provider: { id: number; name: string }; patients: Patient[] }>(
      'GET',
      '/api/patients',
    ),

  createOrder: (patient_id: number) => request<OrderView>('POST', '/api/orders', { patient_id }),
  getOrder: (id: number) => request<OrderView>('GET', `/api/orders/${id}`),
  putItems: (id: number, items: OrderLineInput[]) =>
    request<OrderView>('PUT', `/api/orders/${id}/items`, { items }),
  sendOrder: (id: number) => request<OrderView>('POST', `/api/orders/${id}/send`),
  listOrders: () => request<{ orders: OrderListRow[] }>('GET', '/api/orders'),
  ledger: (id: number) => request<LedgerView>('GET', `/api/orders/${id}/ledger`),

  checkout: (token: string) => request<CheckoutView>('GET', `/api/checkout/${token}`),
  pay: (token: string, idempotency_key: string, payment_method?: PaymentMethodInput) =>
    request<CheckoutView>('POST', `/api/checkout/${token}/pay`, {
      idempotency_key,
      ...(payment_method ? { payment_method } : {}),
    }),
  portal: (token: string) => request<PortalView>('GET', `/api/portal/${token}`),

  dashboard: () => request<DashboardSummary>('GET', '/api/dashboard/summary'),
  inventory: () => request<InventoryView>('GET', '/api/inventory'),
  setInventory: (id: number, inventory_count: number) =>
    request<Supplement>('PATCH', `/api/supplements/${id}/inventory`, { inventory_count }),
};
