/** 本日納品分の状況。notStarted/packed/shipped は箱数（進捗率と同じ箱数基準）。 */
export interface TodayShipmentStats {
  notStarted: number
  packed: number
  shipped: number
  /** (梱包完了＋出荷済み)箱 ÷ 全箱 */
  progressPct: number
  /** 明細数 */
  totalItems: number
  totalBoxes: number
  /** 梱包完了＋出荷済みの箱数 */
  doneBoxes: number
  itemCounts?: { notStarted: number; packed: number; shipped: number }
  amounts?: { notStarted: number | null; packed: number | null; shipped: number | null }
}

/** #44 本日パック作業分（明日納品分）の箱数・パック数・進捗集計 */
export interface TomorrowPackStats {
  deliveryDate: string
  deliveryDateLabel: string
  totalItems: number
  completedItems: number
  totalBoxes: number
  completedBoxes: number
  totalPacks: number
  completedPacks: number
  /** 完成箱数 ÷ 目標箱数（箱数基準） */
  progressPct: number
}

export interface TrendPoint {
  label: string
  value: number
}

export type OrderStatusKey =
  | 'pending_review'
  | 'needs_check'
  | 'approved'
  | 'shipped'
  | 'invoiced'
  | 'cancelled'

export interface RecentOrderRow {
  id: string
  /** 納品日の表示（未定のときは「未定」） */
  date: string
  customer: string
  /** 納入先（あれば「取引先 ＞ 納入先」で出す） */
  destination?: string | null
  itemCount: number
  amount: number
  status: OrderStatusKey
  href?: string
}

export interface SummaryRow {
  key: string
  label: string
  value: string
  deltaPct: number | null
  spark: number[]
  invertDelta?: boolean
  /** 補足（例: 前月同期 ¥12,000） */
  note?: string
}

/** 支払期日を過ぎた未入金の請求書 */
export interface OverdueInvoiceRow {
  id: string
  customer: string
  amount: number
  dueDate: string
  dueLabel: string
}
