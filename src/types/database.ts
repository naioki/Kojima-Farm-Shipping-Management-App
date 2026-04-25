// Supabase データベーススキーマの TypeScript 型定義
// `supabase gen types typescript` コマンドで自動生成した型に対応

export type TapState = 0 | 1 | 2;
export type UserRole = "admin" | "backoffice" | "field" | "customer";
export type OrderSource = "fax" | "email" | "manual" | "b2b_portal" | "i_plus";
export type OrderStatus =
  | "confirmed"
  | "packing"
  | "shipped"
  | "invoiced"
  | "cancelled";
export type VerificationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_correction";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type TenantPlan = "free" | "standard" | "enterprise";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: TenantPlan;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  tenant_id: string;
  role: UserRole;
  display_name: string;
  email: string | null;
  locale: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  name_kana: string | null;
  fax_number: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  base_unit: string;
  price_per_unit: number;
  tax_rate: number;
  category: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UnitConversionMaster {
  id: string;
  tenant_id: string;
  product_id: string;
  from_unit: string;
  to_unit: string;
  multiplier: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MagicLink {
  id: string;
  tenant_id: string;
  customer_id: string;
  token_hash: string;
  email_sent_to: string;
  expires_at: string;
  used_at: string | null;
  session_token: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface OrderVerificationQueue {
  id: string;
  tenant_id: string;
  source: "fax" | "email" | "i_plus";
  raw_data: Record<string, unknown>;
  parsed_data: Record<string, unknown> | null;
  ocr_confidence: number | null;
  raw_storage_path: string | null;
  status: VerificationStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  tenant_id: string;
  customer_id: string;
  source: OrderSource;
  verification_queue_id: string | null;
  delivery_date: string;
  status: OrderStatus;
  notes: string | null;
  raw_input_ref: string | null;
  parsed_data: Record<string, unknown> | null;
  total_amount: number | null;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  tenant_id: string;
  order_id: string;
  product_id: string;
  ordered_qty: number;
  ordered_unit: string;
  converted_qty: number;
  unit_price: number;
  tax_rate: number;
  line_total: number;
  notes: string | null;
  revised_qty: number | null;
  revised_at: string | null;
  revised_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShippingTask {
  id: string;
  tenant_id: string;
  order_item_id: string;
  order_id: string;
  customer_id: string;
  product_id: string;
  delivery_date: string;
  assigned_qty: number;
  tap_state: TapState;
  packed_qty: number | null;
  is_partial: boolean;
  has_unack_change: boolean;
  ack_change_at: string | null;
  acked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeNotification {
  id: string;
  tenant_id: string;
  shipping_task_id: string;
  order_item_id: string;
  previous_qty: number;
  new_qty: number;
  delta: number;
  changed_by: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  period_from: string;
  period_to: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: InvoiceStatus;
  pdf_storage_path: string | null;
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  order_item_id: string;
  product_name: string;
  qty: number;
  unit_price: number;
  tax_rate: number;
  line_total: number;
}

// マトリックスタイムライン行データ型
export interface MatrixRow {
  task_id: string;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  delivery_date: string;
  assigned_qty: number;
  tap_state: TapState;
  is_partial: boolean;
  packed_qty: number | null;
  has_unack_change: boolean;
  unack_delta: number | null;
}

export interface MatrixData {
  delivery_date: string;
  rows: MatrixRow[];
}
