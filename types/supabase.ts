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
  AppSetting,
  CustomerParseHint,
  DeliveryNote,
  DeliveryNoteItem,
  DeliveryDestination,
  AiRule,
  DailyContainerInventory,
  Delivery,
  DeliveryEvent,
  Lot,
  PackConfig,
  PackConfigPhoto,
  PriceRuleRow,
  PrintJob,
  SpecReport,
  OpsEvent,
} from './database'

/**
 * Supabase クライアントに渡すスキーマ型（migrations/0001 〜 0029 完全対応版）。
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
          display_color?: string | null
          channel_identifiers?: Customer['channel_identifiers']
        },
        Partial<Customer>
      >
      delivery_destinations: Table<
        DeliveryDestination,
        {
          customer_id: string
          code?: string | null
          full_name: string
          aliases?: string[]
          sort_order?: number
          pack_sort_order?: number
          shipping_route_name?: string | null
          departure_time?: string | null
          default_container_type?: string | null
          is_active?: boolean
        },
        Partial<DeliveryDestination>
      >
      products: Table<
        Product,
        {
          name: string
          name_kana?: string | null
          aliases?: string[]
          unit?: string
          base_unit?: string | null
          category?: string | null
          default_tax_rate?: Product['default_tax_rate']
          container_capacity?: number | null
          default_unit_price?: number | null
          stock_qty?: number
          photo_url?: string | null
          is_active?: boolean
        },
        Partial<Product>
      >
      orders: Table<
        Order,
        {
          customer_id?: string | null
          destination_id?: string | null
          source: Order['source']
          status?: Order['status']
          order_date?: string
          delivery_date?: string | null
          delivery_date_source?: Order['delivery_date_source']
          confirmed_no_order?: boolean
          shipping_time?: Order['shipping_time']
          note?: string | null
          created_by?: string | null
          intake_channel?: Order['intake_channel']
          approved_at?: string | null
          approved_by?: string | null
        },
        Partial<Order>
      >
      order_items: Table<
        OrderItem,
        Omit<
          {
            order_id: string
            product_id?: string | null
            product_name: string
            quantity: number
            quantity_raw?: string | null
            unit?: string
            pack_config_id?: string | null
            price_status?: OrderItem['price_status']
            billable_qty?: number | null
            billable_reason?: string | null
            pricing_reference_date?: string | null
            priced_at?: string | null
            priced_by?: string | null
            lot_id?: string | null
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
            spec?: string | null
            container_type?: string | null
            has_card?: boolean | null
            line_note?: string | null
            field_note?: string | null
            spec_warnings?: OrderItem['spec_warnings']
            bag_type?: string | null
            seal_text?: string | null
            has_seal?: boolean | null
            daily_pack_sort_order?: number | null
            snap_total_packs?: number | null
            is_manual_modified?: boolean
            is_new_addition?: boolean
            order_key?: string | null
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
          period_start?: string | null
          period_end?: string | null
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
      delivery_notes: Table<
        DeliveryNote,
        {
          note_number: string
          customer_id: string
          customer_name: string
          delivery_date: string
          amount_mode?: DeliveryNote['amount_mode']
          issuer_name?: string | null
          issuer_address?: string | null
          issuer_tel?: string | null
          subtotal_8?: number
          subtotal_10?: number
          total_amount?: number
          issued_by?: string | null
          issued_at?: string
        },
        Partial<DeliveryNote>
      >
      delivery_note_items: Table<
        DeliveryNoteItem,
        {
          delivery_note_id: string
          product_name: string
          quantity: number
          unit?: string
          unit_price?: number
          tax_rate: DeliveryNoteItem['tax_rate']
          subtotal?: number
          sort_order?: number
        },
        Partial<DeliveryNoteItem>
      >
      delivery_note_counters: Table<
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
          spec?: string | null
          has_card?: boolean
          bag_type?: string | null
          has_seal?: boolean
          seal_text?: string | null
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
      app_settings: Table<
        AppSetting,
        { key: string; value?: string | null; is_secret?: boolean; updated_at?: string; updated_by?: string | null },
        Partial<AppSetting>
      >
      customer_parse_hints: Table<
        CustomerParseHint,
        {
          customer_id: string
          raw_name: string
          product_id?: string | null
          corrected_name?: string | null
          note?: string | null
          hit_count?: number
          created_by?: string | null
        },
        Partial<CustomerParseHint>
      >
      ai_rules: Table<
        AiRule,
        {
          client_name: string
          rule_text: string
          is_active?: boolean
          priority?: number
          category?: string
          source?: string
          created_at?: string
          updated_at?: string
        },
        Partial<AiRule>
      >
      daily_container_inventory: Table<
        DailyContainerInventory,
        {
          target_date: string
          product_id: string
          stock_containers?: number
          carryover_to_next_day?: number | null
          updated_at?: string
        },
        Partial<DailyContainerInventory>
      >
      deliveries: Table<
        Delivery,
        {
          delivery_date: string
          customer_id: string
          destination_id?: string | null
          status?: Delivery['status']
          checked_by?: string | null
          checked_at?: string | null
          delivered_by?: string | null
          delivered_at?: string | null
          photo_url?: string | null
          note?: string | null
        },
        Partial<Delivery>
      >
      delivery_events: Table<
        DeliveryEvent,
        {
          delivery_id: string
          actor?: string | null
          action: string
          before?: Record<string, unknown> | null
          after?: Record<string, unknown> | null
        },
        Partial<DeliveryEvent>
      >
      lots: Table<
        Lot,
        {
          lot_no: string
          product_id: string
          field_name?: string | null
          harvest_date?: string | null
          gap_record_ref?: string | null
          note?: string | null
        },
        Partial<Lot>
      >
      pack_configs: Table<
        PackConfig,
        {
          product_id: string
          customer_id?: string | null
          label: string
          inner_unit_label?: string | null
          inner_per?: number | null
          outer_unit_label?: string | null
          outer_per?: number | null
          selling_unit_label: string
          base_per_selling: number
          needs_manual_confirm?: boolean
          is_active?: boolean
          spec_note?: string | null
          has_card?: boolean | null
          has_seal?: boolean | null
          tape_color?: string | null
          label_spec?: string | null
          price_tag_required?: boolean | null
          returnable_container?: boolean | null
          quality_note?: string | null
          standing_notes?: string | null
          field_memo?: string | null
        },
        Partial<PackConfig>
      >
      pack_config_photos: Table<
        PackConfigPhoto,
        {
          pack_config_id: string
          storage_path: string
          kind: PackConfigPhoto['kind']
          sort_order?: number
        },
        Partial<PackConfigPhoto>
      >
      price_rules: Table<
        PriceRuleRow,
        {
          product_id: string
          customer_id?: string | null
          pack_config_id?: string | null
          channel?: PriceRuleRow['channel']
          price_unit?: PriceRuleRow['price_unit']
          unit_price: number
          tax_rate: PriceRuleRow['tax_rate']
          effective_from: string
          effective_to?: string | null
          note?: string | null
          created_by?: string | null
        },
        Partial<PriceRuleRow>
      >
      print_jobs: Table<
        PrintJob,
        {
          doc_type: PrintJob['doc_type']
          target_date: string
          product_id?: string | null
          pdf_url: string
          status?: PrintJob['status']
          error_message?: string | null
          requested_by?: string | null
        },
        Partial<PrintJob>
      >
      spec_reports: Table<
        SpecReport,
        {
          customer_id?: string | null
          product_id?: string | null
          note: string
          photo_url?: string | null
          status?: SpecReport['status']
          reported_by?: string | null
          handled_by?: string | null
          handled_at?: string | null
        },
        Partial<SpecReport>
      >
      ops_events: Table<
        OpsEvent,
        {
          user_id?: string | null
          role?: string | null
          path: string
          event: OpsEvent['event']
          name?: string | null
          active_ms?: number | null
          meta?: Record<string, unknown> | null
        },
        Partial<OpsEvent>
      >
    }
    Views: Record<string, never>
    Functions: {
      get_next_invoice_number: {
        Args: { p_month: string }
        Returns: number
      }
      get_next_delivery_note_number: {
        Args: { p_month: string }
        Returns: number
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
