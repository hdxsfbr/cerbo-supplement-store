// Wire types — mirror contracts/api.md. All money is integer cents, snake_case like the API.

export type OrderStatus = 'draft' | 'awaiting_payment' | 'paid';

export interface Supplement {
  id: number;
  name: string;
  sku: string | null;
  unit_cogs_cents: number;
  default_price_cents: number;
  inventory_count: number;
}

export interface Patient {
  id: number;
  name: string;
  email: string | null;
}

export interface SplitMemos {
  cogs: string;
  provider_margin: string;
  platform_fee: string;
}

export interface SplitView {
  total_cents: number;
  cogs_cents: number;
  fee_cents: number;
  margin_cents: number;
  fee_bps: number;
  memos: SplitMemos;
}

export interface OrderItemView {
  id: number;
  supplement_id: number;
  name: string;
  sku: string | null;
  quantity: number;
  unit_cogs_cents: number;
  unit_price_cents: number;
  /** Patient directions, free text (optional) */
  sig: string | null;
  line_total_cents: number;
  line_cogs_cents: number;
  below_cogs: boolean;
}

export interface OrderView {
  id: number;
  status: OrderStatus;
  provider: { id: number; name: string };
  patient: { id: number; name: string; email: string | null };
  items: OrderItemView[];
  total_cents: number;
  split: SplitView;
  checkout_url: string | null;
  portal_url: string;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  /** What was sent to the patient on send (portal message + email nudge). */
  notifications?: NotificationView[];
  notified?: boolean;
}

export interface NotificationView {
  id: number;
  channel: 'portal_message' | 'email';
  recipient: string | null;
  subject: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface PaymentMethodInput {
  token: string;
  brand: string;
  last4: string;
}

export interface PortalView {
  patient: { id: number; name: string; email: string | null };
  provider: { name: string };
  messages: (NotificationView & { order_id: number | null; order_status: OrderStatus | null })[];
  invoices: {
    id: number;
    status: OrderStatus;
    total_cents: number;
    sent_at: string;
    paid_at: string | null;
    item_count: number;
    checkout_url: string;
    card: { brand: string; last4: string } | null;
    items: {
      name: string;
      sku: string | null;
      quantity: number;
      unit_price_cents: number;
      sig: string | null;
      line_total_cents: number;
    }[];
  }[];
  balance_due_cents: number;
  payment_method: { brand: string; last4: string } | null;
}

export interface PortalSession {
  token: string;
  patient: { id: number; name: string; email: string | null };
  provider: { name: string };
}

export interface OrderListRow {
  id: number;
  status: OrderStatus;
  patient_id: number;
  patient_name: string;
  total_cents: number;
  item_count: number;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
}

export interface OrderLineInput {
  supplement_id: number;
  quantity: number;
  unit_price_cents: number;
  sig?: string | null;
}

export interface CheckoutView {
  id: number;
  status: OrderStatus;
  paid: boolean;
  provider: { name: string };
  patient: { name: string };
  portal_url: string;
  items: {
    name: string;
    sku: string | null;
    quantity: number;
    unit_price_cents: number;
    sig?: string | null;
    line_total_cents: number;
  }[];
  total_cents: number;
  sent_at: string | null;
  paid_at: string | null;
  payment?: {
    id: number;
    idempotency_key: string;
    amount_cents: number;
    gateway_ref: string | null;
    card_brand: string | null;
    card_last4: string | null;
    created_at: string;
  };
}

export interface LedgerEntry {
  id: number;
  entry_type: 'cogs' | 'provider_margin' | 'platform_fee';
  amount_cents: number;
  memo: string | null;
  created_at: string;
}

export interface LedgerView {
  order_id: number;
  status: OrderStatus;
  patient: { id: number; name: string };
  total_cents: number;
  paid_at: string | null;
  payment: {
    id: number;
    idempotency_key: string;
    amount_cents: number;
    gateway_ref: string | null;
    created_at: string;
  };
  entries: LedgerEntry[];
  sum_cents: number;
  fee_computation: {
    total_cents: number;
    fee_bps: number;
    exact: string;
    rounding: string;
    fee_cents: number;
  };
  items: OrderItemView[];
}

export interface DashboardSummary {
  provider: { id: number; name: string };
  orders_paid: number;
  gross_cents: number;
  cogs_cents: number;
  margin_cents: number;
  fees_cents: number;
  paid_orders: {
    id: number;
    patient_name: string;
    paid_at: string;
    total_cents: number;
    cogs_cents: number;
    margin_cents: number;
    fee_cents: number;
  }[];
}

export interface InventoryView {
  provider: { id: number; name: string };
  inventory: (Supplement & {
    units_sold: number;
    units_sold_mine: number;
    low: boolean;
    negative: boolean;
  })[];
  low_stock_threshold: number;
}
