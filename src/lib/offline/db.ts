import Dexie, { type Table } from "dexie";
import type { TapState } from "@/types/database";

// IndexedDB に保存するシッピングタスクのキャッシュ
export interface CachedShippingTask {
  id: string;
  tenant_id: string;
  order_item_id: string;
  order_id: string;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  delivery_date: string;
  assigned_qty: number;
  tap_state: TapState;
  packed_qty: number | null;
  is_partial: boolean;
  has_unack_change: boolean;
  unack_delta: number | null;
  updated_at: string;
  _synced_at: number; // unix timestamp
}

// オフライン時に積み上げる変更キュー（アウトボックスパターン）
export interface OutboxMutation {
  id?: number;
  task_id: string;
  type: "tap" | "partial" | "ack_change";
  payload: Record<string, unknown>;
  created_at: number;
  retry_count: number;
  last_error?: string;
}

// マスタデータキャッシュ（顧客・商品）
export interface CachedCustomer {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
}

export interface CachedProduct {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  base_unit: string;
}

class FieldDatabase extends Dexie {
  shipping_tasks!: Table<CachedShippingTask>;
  outbox!: Table<OutboxMutation>;
  customers!: Table<CachedCustomer>;
  products!: Table<CachedProduct>;

  constructor() {
    super("AgriDXField");
    this.version(1).stores({
      shipping_tasks:
        "id, tenant_id, delivery_date, customer_id, product_id, has_unack_change",
      outbox: "++id, task_id, type, created_at",
      customers: "id, tenant_id",
      products: "id, tenant_id",
    });
  }
}

export const fieldDb = new FieldDatabase();
