export interface TodayShipmentStats {
  notStarted: number
  packed: number
  shipped: number
  progressPct: number
  totalItems: number
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
  date: string
  customer: string
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
}
