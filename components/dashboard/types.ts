/**
 * ダッシュボード表示用のデータ形（presentational props）。
 * /ui-preview（サンプル）と /admin（実Supabase）の双方がこの形に合わせる。
 * ここに集約することで「見た目」と「データ取得」を分離する（react-ui-patterns）。
 */

/** 本日の出荷ステータス集計（件数＋金額）。 */
export interface TodayShipmentStats {
  notStarted: number
  packed: number
  shipped: number
  /** 梱包・出荷の進捗率（0..100）。単位は【明細（品目行）】。 */
  progressPct: number
  /** 総明細件数（進捗の分母表示用）。 */
  totalItems: number
  /** ステータス別の金額（円）。null は未集計（— 表示）。 */
  amounts?: { notStarted: number | null; packed: number | null; shipped: number | null }
  /**
   * 納品の進捗。単位は【配送先（取引先＞納入先）】で、上の明細単位とは分母が違う。
   * 同じ「進捗」でも数字が一致しないのが正常なので、画面では必ず単位を書く。
   */
  deliveries?: { total: number; delivered: number; pct: number }
  /** 出荷（明細）と配送の記録が食い違っている配送先の数。0 が正常。 */
  mismatchCount?: number
}

/** 今月の出荷推移（日次）。 */
export interface TrendPoint {
  /** 'M/D' 等の軸ラベル。 */
  label: string
  /** その日の出荷金額（円）。 */
  value: number
}

/** 受注ステータス（バッジ色分けに使う）。 */
export type OrderStatusKey =
  | 'pending_review'
  | 'needs_check'
  | 'approved'
  | 'shipped'
  | 'invoiced'

/** 最新の受注テーブル1行。 */
export interface RecentOrderRow {
  id: string
  /** 受注日 'M/D'。 */
  date: string
  customer: string
  itemCount: number
  amount: number
  status: OrderStatusKey
  href?: string
}

/** 今月のサマリー1行（値＋前月比＋スパークライン）。 */
export interface SummaryRow {
  key: string
  label: string
  /** 整形済み表示値（¥や件を含む文字列）。 */
  value: string
  /** 前月比（%）。null は比較対象なし。 */
  deltaPct: number | null
  /** スパークライン用の系列（小さい順の時系列）。 */
  spark: number[]
  /** delta の良し悪し。未請求額のように「減=良」の指標は invert=true。 */
  invertDelta?: boolean
}
