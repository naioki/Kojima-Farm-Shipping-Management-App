import type {
  User,
  Customer,
  Product,
  Order,
  OrderItem,
  HarvestTask,
  Invoice,
  InvoiceItem,
  AuditLog,
  OrderReceipt,
  CustomerProductRule,
  HarvestEstimate,
  GeminiUsageLog,
} from './database'

/**
 * Supabase クライアントに渡すスキーマ型（手書き版）。
 * 本来は `supabase gen types typescript` で生成するが、ローカルDBが無い段階のため
 * migrations/0001・0002 に対応する形を手書きで持つ。実DB接続後は生成版に差し替え推奨。
 *
 * Row は types/database.ts の行型を再利用。Insert は DB 既定値/生成列/NULL 可の列を任意にする。
 * Update はすべて任意（Partial）。生成列（subtotal/tax_amount/line_total）は Insert/Update から除外。
 */

type Generated = 'subtotal' | 'tax_amount' | 'line_total'

interface Table<Row, Insert, Update> {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      users: Table<
        User,
        { id: string; email?: string | null; full_name?: string | null; role?: User['role'] },
        Partial<User>
      >
      customers: Table<
        Customer,
        {
          name: string
          name_kana?: string | null
          closing_rule?: string
          invoice_reg_num?: string | null
          payment_terms?: string | null
          is_active?: boolean
          channel_identifiers?: Customer['channel_identifiers']
        },
        Partial<Customer>
      >
      products: Table<
        Product,
        {
          name: string
          name_kana?: string | null
          aliases?: string[]
          unit?: string
          default_tax_rate?: Product['default_tax_rate']
          container_capacity?: number | null
          default_unit_price?: number | null
          is_active?: boolean
        },
        Partial<Product>
      >
      orders: Table<
        Order,
        {
          customer_id: string
          source: Order['source']
          status?: Order['status']
          order_date?: string
          delivery_date?: string | null
          delivery_date_source?: Order['delivery_date_source']
          confirmed_no_order?: boolean
          shipping_time?: Order['shipping_time']
          note?: string | null
          created_by?: string | null
        },
        Partial<Order>
      >
      order_items: Table<
        OrderItem,
        Omit<
          {
            order_id: string
            product_id: string
            product_name: string
            quantity: number
            unit?: string
            unit_price: number
            tax_rate: OrderItem['tax_rate']
            version?: number
            rule_id?: string | null
            confidence?: number | null
            is_flagged?: boolean
            shipped_qty?: number | null
            shipped_at?: string | null
            field_status?: OrderItem['field_status']
            fraction_note?: string | null
          },
          Generated
        >,
        Partial<Omit<OrderItem, Generated>>
      >
      harvest_tasks: Table<
        HarvestTask,
        {
          product_id: string
          order_item_id?: string | null
          required_qty?: number
          task_date: string
          assigned_to?: string | null
          status?: HarvestTask['status']
        },
        Partial<HarvestTask>
      >
      invoices: Table<
        Invoice,
        {
          invoice_number: string
          customer_id: string
          billing_month: string
          issue_date?: string | null
          due_date?: string | null
          invoice_reg_num?: string | null
          subtotal_8?: number
          tax_8?: number
          subtotal_10?: number
          tax_10?: number
          total_amount?: number
          status?: Invoice['status']
          pdf_r2_key?: string | null
          created_by?: string | null
        },
        Partial<Invoice>
      >
      invoice_items: Table<
        InvoiceItem,
        Omit<
          {
            invoice_id: string
            order_item_id?: string | null
            product_name: string
            quantity: number
            unit?: string
            unit_price: number
            tax_rate: InvoiceItem['tax_rate']
          },
          Generated
        >,
        Partial<Omit<InvoiceItem, Generated>>
      >
      audit_log: Table<
        AuditLog,
        {
          entity_type: string
          entity_id: string
          action: AuditLog['action']
          changed_fields?: string[] | null
          old_values?: Record<string, unknown> | null
          new_values?: Record<string, unknown> | null
          user_id?: string | null
        },
        Partial<AuditLog>
      >
      invoice_counters: Table<
        { month: string; last_seq: number },
        { month: string; last_seq?: number },
        { month?: string; last_seq?: number }
      >
      order_receipts: Table<
        OrderReceipt,
        {
          channel: OrderReceipt['channel']
          customer_id?: string | null
          order_id?: string | null
          received_at?: string
          delivery_date?: string | null
          sender_date_key?: string | null
          exact_hash?: string | null
          message_id?: string | null
          r2_key?: string | null
          raw_payload?: Record<string, unknown> | null
          is_revision?: boolean
          parent_id?: string | null
          ocr_confidence?: number | null
          status?: OrderReceipt['status']
          retry_count?: number
          next_retry_at?: string | null
          error_message?: string | null
        },
        Partial<OrderReceipt>
      >
      customer_product_rules: Table<
        CustomerProductRule,
        {
          customer_id: string
          product_id: string
          packs_per_case?: number | null
          container_type?: string | null
          label_spec?: string | null
          tape_color?: string | null
          packing_notes?: string | null
          fraction_policy?: CustomerProductRule['fraction_policy']
          is_default_set?: boolean
          default_quantity?: number | null
        },
        Partial<CustomerProductRule>
      >
      harvest_estimates: Table<
        HarvestEstimate,
        {
          product_id: string
          estimate_date: string
          planned_qty?: number | null
          estimate_qty?: number | null
          actual_qty?: number | null
          carry_over?: number
          adjustment_memo?: string | null
          status?: HarvestEstimate['status']
          created_by?: string | null
        },
        Partial<HarvestEstimate>
      >
      gemini_usage_log: Table<
        GeminiUsageLog,
        {
          mode?: string | null
          channel?: string | null
          tokens_used?: number | null
          success?: boolean | null
        },
        Partial<GeminiUsageLog>
      >
    }
    Views: Record<string, never>
    Functions: {
      get_next_invoice_number: {
        Args: { p_month: string }
        Returns: number
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
