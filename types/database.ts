import { z } from 'zod'

/**
 * DB スキーマの TypeScript 型 + Zod スキーマ（Phase A）。
 * migrations/0001 + 0002 と一対一で対応させる。API 入力は必ずここの Zod で検証する（security.md）。
 *
 * 金額・数量は DB では NUMERIC。JS 側では文字列で受けて Decimal.js で扱うのが安全だが、
 * 行型の表現としては number を使い、計算境界（lib/calculations）で Decimal に変換する。
 */

// ============================================================
// 列挙・共通
// ============================================================
export type Channel = 'fax' | 'email' | 'portal' | 'manual'
export type TaxRate = 8 | 10
export type UserRole = 'admin' | 'staff'
export type OrderStatus = 'pending_review' | 'approved' | 'shipped' | 'invoiced' | 'cancelled'
export type FieldStatus = 'not_started' | 'packed' | 'shipped'
export type HarvestTaskStatus =
  | 'not_started'
  | 'harvesting'
  | 'packing'
  | 'completed'
  | 'delayed'
export type InvoiceStatus = 'draft' | 'finalized' | 'sent' | 'paid' | 'void'
export type ReceiptStatus =
  | 'pending_ai'
  | 'ai_failed'
  | 'pending_review'
  | 'approved'
  | 'duplicate'
  | 'unmatched'
export type FractionPolicy = 'carry_over' | 'loose' | 'round_down' | 'confirm'
export type EstimateStatus = 'not_entered' | 'planned' | 'estimated' | 'confirmed'
export type DeliveryDateSource = 'parsed' | 'manual' | 'assumed_next_day'
export type ShippingTime = 'am' | 'pm'
export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'undo'

export const taxRateSchema = z.union([z.literal(8), z.literal(10)])
export const channelSchema = z.enum(['fax', 'email', 'portal', 'manual'])

type UUID = string
type ISODate = string // 'YYYY-MM-DD'
type ISODateTime = string

// ============================================================
// Row 型（SELECT の結果）
// ============================================================
export interface User {
  id: UUID
  email: string | null
  full_name: string | null
  role: UserRole
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface Customer {
  id: UUID
  name: string
  name_kana: string | null
  closing_rule: string
  invoice_reg_num: string | null
  payment_terms: string | null
  is_active: boolean
  channel_identifiers: ChannelIdentifiers
  /** タスク画面での識別用カラー（hex）。null = 名前から自動割り当て（migrations/0008） */
  display_color: string | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

/** customers.channel_identifiers（features.md §1） */
export interface ChannelIdentifiers {
  fax?: string[]
  email?: string[]
  portal_user_id?: string
  line_works_id?: string
}

export interface Product {
  id: UUID
  name: string
  name_kana: string | null
  aliases: string[]
  unit: string
  default_tax_rate: TaxRate
  container_capacity: number | null
  default_unit_price: number | null
  stock_qty: number
  is_active: boolean
  /** 商品識別サムネイルURL（40×40px）。migrations/0008 */
  photo_url: string | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

/** 設定（app_settings）。is_secret=true の値は画面に返さない（書き込み専用扱い）。 */
export interface AppSetting {
  key: string
  value: string | null
  is_secret: boolean
  updated_at: ISODateTime
  updated_by: UUID | null
}

export interface Order {
  id: UUID
  customer_id: UUID
  source: Channel
  status: OrderStatus
  order_date: ISODate
  delivery_date: ISODate | null
  delivery_date_source: DeliveryDateSource | null
  confirmed_no_order: boolean
  shipping_time: ShippingTime | null
  note: string | null
  created_by: UUID | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface OrderItem {
  id: UUID
  order_id: UUID
  product_id: UUID
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: TaxRate
  /** 生成列（読み取り専用） */
  subtotal: number
  tax_amount: number
  line_total: number
  /** 楽観ロック（features.md §6） */
  version: number
  rule_id: UUID | null
  confidence: number | null
  is_flagged: boolean
  shipped_qty: number | null
  shipped_at: ISODateTime | null
  field_status: FieldStatus
  fraction_note: string | null
  /** 荷姿まわり（規則から自動補完＋出荷ごとに上書き可・migrations/0005） */
  spec: string | null
  container_type: string | null
  has_card: boolean | null
  line_note: string | null
  /** 現場メモ（中断理由・気づき等。現場→事務の報告・migrations/0006） */
  field_note: string | null
  /** 梱包時注意事項 [{type:'forbidden'|'required', text:string}]（migrations/0008） */
  spec_warnings: SpecWarning[] | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface SpecWarning {
  type: 'forbidden' | 'required'
  text: string
}

export interface HarvestTask {
  id: UUID
  product_id: UUID
  order_item_id: UUID | null
  required_qty: number
  task_date: ISODate
  assigned_to: UUID | null
  status: HarvestTaskStatus
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface Invoice {
  id: UUID
  invoice_number: string
  customer_id: UUID
  billing_month: string // 'YYYY-MM'（採番・表示用。任意期間でも period_end の月を入れる）
  period_start: ISODate | null
  period_end: ISODate | null
  issue_date: ISODate | null
  due_date: ISODate | null
  invoice_reg_num: string | null
  subtotal_8: number
  tax_8: number
  subtotal_10: number
  tax_10: number
  total_amount: number
  status: InvoiceStatus
  pdf_r2_key: string | null
  created_by: UUID | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface InvoiceItem {
  id: UUID
  invoice_id: UUID
  order_item_id: UUID | null
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: TaxRate
  subtotal: number
  tax_amount: number
  line_total: number
  created_at: ISODateTime
}

/** 納品書ヘッダー（発行時スナップショット・migrations/0007） */
export interface DeliveryNote {
  id: UUID
  note_number: string
  customer_id: UUID
  customer_name: string
  delivery_date: ISODate
  amount_mode: 'full' | 'blank' | 'none'
  issuer_name: string | null
  issuer_address: string | null
  issuer_tel: string | null
  subtotal_8: number
  subtotal_10: number
  total_amount: number
  issued_by: UUID | null
  issued_at: ISODateTime
  created_at: ISODateTime
}

/** 納品書明細（発行時スナップショット・subtotal は凍結値） */
export interface DeliveryNoteItem {
  id: UUID
  delivery_note_id: UUID
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: TaxRate
  subtotal: number
  sort_order: number
  created_at: ISODateTime
}

export interface AuditLog {
  id: UUID
  entity_type: string
  entity_id: UUID
  action: AuditAction
  changed_fields: string[] | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  user_id: UUID | null
  created_at: ISODateTime
}

export interface OrderReceipt {
  id: UUID
  channel: Channel
  customer_id: UUID | null
  order_id: UUID | null
  received_at: ISODateTime
  delivery_date: ISODate | null
  sender_date_key: string | null
  exact_hash: string | null
  message_id: string | null
  r2_key: string | null
  raw_payload: Record<string, unknown> | null
  is_revision: boolean
  parent_id: UUID | null
  ocr_confidence: number | null
  status: ReceiptStatus
  retry_count: number
  next_retry_at: ISODateTime | null
  error_message: string | null
  created_at: ISODateTime
}

export interface CustomerProductRule {
  id: UUID
  customer_id: UUID
  product_id: UUID
  packs_per_case: number | null
  container_type: string | null
  label_spec: string | null
  tape_color: string | null
  packing_notes: string | null
  fraction_policy: FractionPolicy
  is_default_set: boolean
  default_quantity: number | null
  spec: string | null
  has_card: boolean
  created_at: ISODateTime
}

export interface HarvestEstimate {
  id: UUID
  product_id: UUID
  estimate_date: ISODate
  planned_qty: number | null
  estimate_qty: number | null
  actual_qty: number | null
  carry_over: number
  adjustment_memo: string | null
  status: EstimateStatus
  created_by: UUID | null
  updated_at: ISODateTime
}

/** 取引先ごとの表記学習（few-shot の素）。 */
export interface CustomerParseHint {
  id: UUID
  customer_id: UUID
  raw_name: string
  product_id: UUID | null
  corrected_name: string | null
  note: string | null
  hit_count: number
  created_by: UUID | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface GeminiUsageLog {
  id: UUID
  called_at: ISODateTime
  mode: string | null
  channel: string | null
  tokens_used: number | null
  success: boolean | null
}

// ============================================================
// Zod 入力スキーマ（API 境界で使用）
// ============================================================

/** 注文明細の作成入力（税率は注文時に確定して冗長保持・tax.md） */
export const orderItemInputSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1).default('個'),
  unit_price: z.number().nonnegative(),
  tax_rate: taxRateSchema,
  rule_id: z.string().uuid().nullish(),
  confidence: z.number().min(0).max(1).nullish(),
})
export type OrderItemInput = z.infer<typeof orderItemInputSchema>

/** 注文の作成入力 */
export const orderInputSchema = z.object({
  customer_id: z.string().uuid(),
  source: channelSchema,
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  delivery_date_source: z.enum(['parsed', 'manual', 'assumed_next_day']).nullish(),
  shipping_time: z.enum(['am', 'pm']).nullish(),
  note: z.string().nullish(),
  items: z.array(orderItemInputSchema).min(1),
})
export type OrderInput = z.infer<typeof orderInputSchema>

/** 数量変更（楽観ロック・features.md §6）。version 必須。 */
export const orderItemPatchSchema = z.object({
  quantity: z.number().nonnegative().optional(),
  unit_price: z.number().nonnegative().optional(),
  tax_rate: taxRateSchema.optional(),
  fraction_note: z.string().nullish(),
  /** 荷姿まわり（アコーディオンで編集・migrations/0005） */
  spec: z.string().nullish(),
  container_type: z.string().nullish(),
  has_card: z.boolean().nullish(),
  line_note: z.string().nullish(),
  /** 現場の記録（中断時の部分完了数・現場メモ・migrations/0006） */
  shipped_qty: z.number().nonnegative().nullish(),
  field_note: z.string().nullish(),
  /** 期待 version。不一致は 409（競合） */
  version: z.number().int().positive(),
})
export type OrderItemPatch = z.infer<typeof orderItemPatchSchema>

/** 圃場タップ（field_status 前進・features.md §7） */
export const fieldStatusPatchSchema = z.object({
  field_status: z.enum(['not_started', 'packed', 'shipped']),
  shipped_qty: z.number().nonnegative().nullish(),
  version: z.number().int().positive(),
})
export type FieldStatusPatch = z.infer<typeof fieldStatusPatchSchema>

/**
 * 出荷一覧の「スマート追加」入力（Laravel版 画面2）。
 * 数量はスマートパース対象の生文字列（"15c2" 等）をそのまま受け、サーバ側で
 * customer_product_rules.packs_per_case を使って総数に確定する（features.md §5）。
 */
export const shipmentAddSchema = z.object({
  customer_id: z.string().uuid(),
  product_id: z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity_raw: z.string().min(1),
})
export type ShipmentAddInput = z.infer<typeof shipmentAddSchema>

/** field_status を1段戻すリセット（features.md §7：長押し＋確認で実行）。version 必須。 */
export const fieldStatusResetSchema = z.object({
  version: z.number().int().positive(),
})
export type FieldStatusReset = z.infer<typeof fieldStatusResetSchema>

/** 納品書の発行（スナップショット保存）。取引先×納品日のその日の明細を凍結する。 */
export const deliveryNoteCreateSchema = z.object({
  customer_id: z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_mode: z.enum(['full', 'blank', 'none']).default('full'),
})
export type DeliveryNoteCreateInput = z.infer<typeof deliveryNoteCreateSchema>

/**
 * 商品（品目）の新規作成（設定から追加）。
 * 週間マトリックスの品目タブ・スマート追加の選択肢になる。税率は 8（軽減）/10（標準）のみ（tax.md）。
 */
export const productCreateSchema = z.object({
  name: z.string().min(1),
  name_kana: z.string().nullish(),
  unit: z.string().min(1).default('個'),
  default_tax_rate: taxRateSchema.default(8),
  container_capacity: z.number().positive().nullish(),
  default_unit_price: z.number().nonnegative().nullish(),
})
export type ProductCreateInput = z.infer<typeof productCreateSchema>

/** 取引先の表記学習を1件保存（承認画面の修正時）。 */
export const customerParseHintSchema = z.object({
  customer_id: z.string().uuid(),
  raw_name: z.string().min(1),
  product_id: z.string().uuid().nullish(),
  corrected_name: z.string().nullish(),
  note: z.string().nullish(),
})
export type CustomerParseHintInput = z.infer<typeof customerParseHintSchema>

/** 請求書のステータス更新（draft→finalized など）。 */
export const invoiceStatusPatchSchema = z.object({
  status: z.enum(['draft', 'finalized', 'sent', 'paid', 'void']),
})
export type InvoiceStatusPatch = z.infer<typeof invoiceStatusPatchSchema>

/** 商品の更新（編集・在庫調整）。すべて任意。 */
export const productUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  name_kana: z.string().nullish(),
  unit: z.string().min(1).optional(),
  default_tax_rate: taxRateSchema.optional(),
  container_capacity: z.number().positive().nullish(),
  default_unit_price: z.number().nonnegative().nullish(),
  stock_qty: z.number().optional(),
  is_active: z.boolean().optional(),
})
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>

/** 設定の一括更新（設定画面）。キーは SETTINGS_SPEC で検証する。空文字の秘密値は「変更なし」。 */
export const settingsUpdateSchema = z.object({
  entries: z.array(z.object({ key: z.string().min(1), value: z.string() })).min(1),
})
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>

/** 取引先の新規作成（Laravel版 画面5） */
export const customerCreateSchema = z.object({
  name: z.string().min(1),
  name_kana: z.string().nullish(),
  payment_terms: z.string().nullish(),
})
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>

/** 取引先の更新（情報編集・有効/無効）。全項目任意。 */
export const customerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  name_kana: z.string().nullish(),
  payment_terms: z.string().nullish(),
  is_active: z.boolean().optional(),
  /** タスク画面の識別色（hex or null でリセット）*/
  display_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
})
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>

/**
 * 取引先×商品の取引ルール upsert（Laravel版 画面5：P/C・荷姿・いつものセット）。
 * (customer_id, product_id) で一意。スマートパース/OCR検証の基準値 packs_per_case を持つ。
 */
export const customerProductRuleUpsertSchema = z.object({
  customer_id: z.string().uuid(),
  product_id: z.string().uuid(),
  packs_per_case: z.number().positive().nullish(),
  container_type: z.string().nullish(),
  label_spec: z.string().nullish(),
  tape_color: z.string().nullish(),
  packing_notes: z.string().nullish(),
  fraction_policy: z.enum(['carry_over', 'loose', 'round_down', 'confirm']).optional(),
  is_default_set: z.boolean().optional(),
  default_quantity: z.number().nonnegative().nullish(),
  spec: z.string().nullish(),
  has_card: z.boolean().optional(),
})
export type CustomerProductRuleUpsert = z.infer<typeof customerProductRuleUpsertSchema>

/**
 * 週間マトリックスのセル更新（Laravel版 画面3）。
 * quantity_raw が空文字なら「その日の出荷レコードを削除」（features.md §5 の空欄=削除仕様）。
 * 空以外は customer_product_rules.packs_per_case でスマートパースして総数に確定する。
 */
export const matrixCellSchema = z.object({
  customer_id: z.string().uuid(),
  product_id: z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity_raw: z.string(), // 空文字＝削除
})
export type MatrixCellInput = z.infer<typeof matrixCellSchema>

/** ポータル発注（features.md §2-3：confidence は常に 1.0、delivery_date 必須） */
export const portalOrderInputSchema = z.object({
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
})
export type PortalOrderInput = z.infer<typeof portalOrderInputSchema>

// ============================================================
// 規格の現場報告（spec_reports・migrations/0009）
// ============================================================
export type SpecReportStatus = 'pending' | 'handled' | 'dismissed'

export interface SpecReport {
  id: UUID
  customer_id: UUID | null
  product_id: UUID | null
  note: string
  photo_url: string | null
  status: SpecReportStatus
  reported_by: UUID | null
  handled_by: UUID | null
  handled_at: ISODateTime | null
  created_at: ISODateTime
}

/** 現場からの規格変更報告（写真＋メモ。直接編集ではない）。photo は base64（任意）。 */
export const specReportCreateSchema = z.object({
  customer_id: z.string().uuid().nullish(),
  product_id: z.string().uuid().nullish(),
  note: z.string().min(1).max(2000),
  /** 写真（任意）。data URL の接頭辞を除いた base64。 */
  photoBase64: z.string().min(1).optional(),
  photoMimeType: z.string().optional(),
})
export type SpecReportCreateInput = z.infer<typeof specReportCreateSchema>

/** 管理者による報告の処理（対応済み/却下）。 */
export const specReportUpdateSchema = z.object({
  status: z.enum(['handled', 'dismissed']),
})
export type SpecReportUpdateInput = z.infer<typeof specReportUpdateSchema>
