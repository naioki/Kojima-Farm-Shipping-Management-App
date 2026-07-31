import type { DeliveryStatus, FieldStatus } from '@/types/database'
import { deliveryUnitKey } from '@/lib/deliveries/unit'

/**
 * 「今日どれだけ終わったか」の単一の計算。
 *
 * これまで経営側には答えが2つあった:
 *   - ダッシュボード「進捗率」= order_items.field_status が shipped の【明細】割合
 *   - 配送実績「完了率」    = deliveries.status が delivered の【配送先】割合
 * 単位（明細 / 配送先）も集計元も違うのに、どちらも「進捗」としか書かれておらず、
 * 同じ日でも数字が食い違う。しかも両者は連動していないので、
 *   「納品完了になっているのに、明細は未出荷のまま」
 * のような矛盾が起きても誰も気づけなかった。
 *
 * ここで両方を1回で計算し、
 *   - それぞれの単位を明示した数字
 *   - 2つが食い違っている配送先（＝どちらかの記録が漏れている）
 * を返す。数字を1つに丸めない: 明細の梱包進捗と配送先の納品完了は別の情報で、
 * どちらも経営が見たいもの。丸めずに「単位を書く」ことで誤読を防ぐ。
 */

export interface ProgressItem {
  customerId: string
  destinationId: string | null
  fieldStatus: FieldStatus | string | null
  lineTotal?: number | null
}

export interface ProgressDelivery {
  customerId: string
  destinationId: string | null
  status: DeliveryStatus | string | null
}

/** 明細（品目行）単位の進捗。 */
export interface ItemProgress {
  total: number
  notStarted: number
  packed: number
  shipped: number
  /** 出荷済みの割合(%)。対象0件なら0。 */
  pct: number
  amounts: { notStarted: number; packed: number; shipped: number }
}

/** 配送先（取引先＞納入先）単位の進捗。 */
export interface DeliveryProgress {
  total: number
  planned: number
  loaded: number
  delivered: number
  /** 納品完了の割合(%)。対象0件なら0。 */
  pct: number
}

export type MismatchKind =
  /** 納品完了なのに、その配送先の明細に未出荷が残っている */
  | 'delivered_but_not_shipped'
  /** 明細は全部出荷済みなのに、配送の納品完了が記録されていない */
  | 'shipped_but_not_delivered'

export interface ProgressMismatch {
  /** deliveryUnitKey() の値。呼び出し側が取引先名に変換する */
  key: string
  kind: MismatchKind
  /** 食い違いに関係する明細数（未出荷の数 / 出荷済みの数） */
  itemCount: number
}

export interface TodayProgress {
  items: ItemProgress
  deliveries: DeliveryProgress
  /** 2つの記録が食い違っている配送先。0件なら経営は数字をそのまま信じてよい */
  mismatches: ProgressMismatch[]
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

/**
 * 明細と配送の両方から今日の進捗を出し、食い違いを検出する。
 * 純粋関数（DB アクセスなし）。呼び出し側は同じ日・同じ絞り込みのデータを渡すこと。
 */
export function computeTodayProgress(input: {
  items: readonly ProgressItem[]
  deliveries: readonly ProgressDelivery[]
}): TodayProgress {
  const { items, deliveries } = input

  // --- 明細単位 ---
  const ip: ItemProgress = {
    total: items.length,
    notStarted: 0,
    packed: 0,
    shipped: 0,
    pct: 0,
    amounts: { notStarted: 0, packed: 0, shipped: 0 },
  }
  for (const it of items) {
    const amount = it.lineTotal ?? 0
    if (it.fieldStatus === 'shipped') {
      ip.shipped++
      ip.amounts.shipped += amount
    } else if (it.fieldStatus === 'packed') {
      ip.packed++
      ip.amounts.packed += amount
    } else {
      ip.notStarted++
      ip.amounts.notStarted += amount
    }
  }
  ip.pct = pct(ip.shipped, ip.total)

  // --- 配送先単位 ---
  // deliveries 行は「配送先ごとに1行」。まだ1度も触っていない配送先は行自体が無いので、
  // 明細から出てくる配送先も母数に含める（行が無い＝planned として数える）。
  // これをしないと、朝いちばん（deliveries が0行）に完了率100%と出てしまう。
  const statusByUnit = new Map<string, DeliveryStatus | string | null>()
  for (const d of deliveries) {
    statusByUnit.set(deliveryUnitKey(d.customerId, d.destinationId), d.status)
  }
  const unitsFromItems = new Map<string, ProgressItem[]>()
  for (const it of items) {
    const key = deliveryUnitKey(it.customerId, it.destinationId)
    const arr = unitsFromItems.get(key) ?? []
    arr.push(it)
    unitsFromItems.set(key, arr)
  }
  const allUnits = new Set<string>([...statusByUnit.keys(), ...unitsFromItems.keys()])

  const dp: DeliveryProgress = { total: allUnits.size, planned: 0, loaded: 0, delivered: 0, pct: 0 }
  for (const key of allUnits) {
    const status = statusByUnit.get(key) ?? 'planned'
    if (status === 'delivered') dp.delivered++
    else if (status === 'loaded') dp.loaded++
    else dp.planned++
  }
  dp.pct = pct(dp.delivered, dp.total)

  // --- 食い違いの検出 ---
  const mismatches: ProgressMismatch[] = []
  for (const [key, unitItems] of unitsFromItems) {
    const status = statusByUnit.get(key) ?? 'planned'
    const unshipped = unitItems.filter((it) => it.fieldStatus !== 'shipped')
    if (status === 'delivered' && unshipped.length > 0) {
      // 納品したのに出荷済みにしていない ＝ 出荷一覧側の記録漏れ（売上・請求に響く）
      mismatches.push({ key, kind: 'delivered_but_not_shipped', itemCount: unshipped.length })
    } else if (status !== 'delivered' && unshipped.length === 0 && unitItems.length > 0) {
      // 出荷済みなのに納品完了にしていない ＝ 配送側の記録漏れ（誤配送調査の証跡が残らない）
      mismatches.push({ key, kind: 'shipped_but_not_delivered', itemCount: unitItems.length })
    }
  }

  return { items: ip, deliveries: dp, mismatches }
}
