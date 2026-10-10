// Typed API client. Cents pass straight through as integers; the server's error envelope
// { error: { code, message } } becomes an ApiError. The acting-provider header is the identity
// seam's stand-in for an EHR session (contracts/api.md).

import type {
  CheckoutView,
  DashboardSummary,
  LedgerView,
  OrderLineInput,
  OrderListRow,
  OrderRequest,
  OrderView,
  Patient,
  PatientSupplement,
  ProviderOrderRequest,
  PaymentMethodInput,
  PortalSession,
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

  createOrder: (
    patient_id: number,
    from?: { patient_supplement_ids?: number[]; request_id?: number },
  ) => request<OrderView>('POST', '/api/orders', { patient_id, ...(from ?? {}) }),

  // The patient's supplement list (provider side) and order requests
  patientSupplements: (patientId: number) =>
    request<{ supplements: PatientSupplement[]; requests: OrderRequest[] }>(
      'GET',
      `/api/patients/${patientId}/supplements`,
    ),
  addPatientSupplement: (patientId: number, supplement_id: number, sig: string | null) =>
    request<PatientSupplement>('POST', `/api/patients/${patientId}/supplements`, {
      supplement_id,
      sig,
    }),
  patchPatientSupplement: (
    id: number,
    patch: { sig?: string | null; status?: 'active' | 'discontinued' },
  ) => request<PatientSupplement>('PATCH', `/api/patient-supplements/${id}`, patch),
  requests: () => request<{ requests: ProviderOrderRequest[] }>('GET', '/api/requests'),
  declineRequest: (id: number, note: string | null) =>
    request<ProviderOrderRequest>('POST', `/api/requests/${id}/decline`, { note }),
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
  portalSignIn: (patient_id: number) =>
    request<PortalSession>('POST', '/api/portal/session', { patient_id }),
  portalAddSupplement: (token: string, supplement_id: number, sig: string | null) =>
    request<PatientSupplement>('POST', `/api/portal/${token}/supplements`, { supplement_id, sig }),
  portalRequest: (token: string, patient_supplement_ids: number[], note: string | null) =>
    request<OrderRequest>('POST', `/api/portal/${token}/requests`, {
      patient_supplement_ids,
      note,
    }),

  dashboard: () => request<DashboardSummary>('GET', '/api/dashboard/summary'),
};
