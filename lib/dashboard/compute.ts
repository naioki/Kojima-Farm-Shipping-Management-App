/**
 * ダッシュボード・かんたん画面の集計（純関数・DB非依存）。
 * 数字の定義をここに集め、admin-data.ts（取得）と画面の両方から使う。テストは compute.test.ts。
 */

export interface DateRange {
  /** 'YYYY-MM-DD'（含む） */
  start: string
  /** 'YYYY-MM-DD'（含む） */
  end: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymdUtc = (d: Date) => d.toISOString().slice(0, 10)

function lastDayOfMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

/**
 * 今月1日〜今日 と、前月の同じ日数（前月1日〜前月の同じ日）。
 * 前月にその日が無いとき（3/31 → 2/31 など）は前月末日で止める。
 */
export function monthToDateRanges(today: string): { cur: DateRange; prev: DateRange; curYm: string; prevYm: string } {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const m0 = m - 1
  const py = m0 === 0 ? y - 1 : y
  const pm0 = m0 === 0 ? 11 : m0 - 1
  const pd = Math.min(d, lastDayOfMonth(py, pm0))
  return {
    cur: { start: `${y}-${pad2(m)}-01`, end: today },
    prev: { start: `${py}-${pad2(pm0 + 1)}-01`, end: `${py}-${pad2(pm0 + 1)}-${pad2(pd)}` },
    curYm: `${y}-${pad2(m)}`,
    prevYm: `${py}-${pad2(pm0 + 1)}`,
  }
}

export function inRange(date: string | null | undefined, r: DateRange): boolean {
  return !!date && date >= r.start && date <= r.end
}

/** 増減率（%）。比較元が0以下なら比べられないので null。 */
export function pctChange(curr: number, prev: number): number | null {
  if (!(prev > 0)) return null
  return ((curr - prev) / prev) * 100
}

/** 金額の合計。DB の numeric が文字列で返っても足し算が文字列連結にならないよう Number で受ける。 */
export function sumAmounts(rows: ReadonlyArray<{ line_total?: number | string | null }> | null | undefined): number {
  let s = 0
  for (const r of rows ?? []) s += Number(r.line_total) || 0
  return s
}

export interface DatedAmount {
  date: string | null
  amount: number | string | null
}

export function sumInRange(rows: ReadonlyArray<DatedAmount>, r: DateRange): number {
  let s = 0
  for (const row of rows) if (inRange(row.date, r)) s += Number(row.amount) || 0
  return s
}

/** 日次の推移。start〜end の全日を並べ、出荷のない日は 0 で埋める（日付が飛ぶと折れ線が誤解を生む）。 */
export function dailyTrend(rows: ReadonlyArray<DatedAmount>, r: DateRange): { date: string; label: string; value: number }[] {
  const byDay = new Map<string, number>()
  for (const row of rows) {
    if (!inRange(row.date, r)) continue
    byDay.set(row.date!, (byDay.get(row.date!) ?? 0) + (Number(row.amount) || 0))
  }
  const out: { date: string; label: string; value: number }[] = []
  const end = new Date(`${r.end}T00:00:00Z`)
  for (let d = new Date(`${r.start}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = ymdUtc(d)
    out.push({ date: key, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, value: byDay.get(key) ?? 0 })
  }
  return out
}

/** グラフ縦軸の単位。最大値に合わせて 円 / 千円 / 万円 を選ぶ（0.0x 万円や「8,000」のような幅を取る目盛りを避け、目盛りを3桁以内に収める）。 */
export function chooseYenUnit(maxValue: number): { divisor: number; label: string } {
  const m = Math.abs(maxValue)
  if (m >= 1_000_000) return { divisor: 10_000, label: '万円' }
  if (m >= 1_000) return { divisor: 1_000, label: '千円' }
  return { divisor: 1, label: '円' }
}

/** 目盛りの数値（単位換算後）。10未満は小数1桁まで（整数に丸めると目盛りが重複する）。 */
export function formatAxisTick(value: number, divisor: number): string {
  const v = value / divisor
  if (divisor === 1) return Math.round(v).toLocaleString('ja-JP')
  return Math.abs(v) < 10 ? String(Math.round(v * 10) / 10) : Math.round(v).toLocaleString('ja-JP')
}

// ---------------------------------------------------------------------------
// 請求
// ---------------------------------------------------------------------------

/** 「請求した」と数える請求書の状態。下書き・無効は含めない。 */
export const ISSUED_INVOICE_STATUSES = ['finalized', 'sent', 'paid'] as const

export interface InvoiceLite {
  status: string
  issue_date: string | null
  /** 'YYYY-MM-DD'（JST）に直した作成日。発行日が空のときの代わり。 */
  created_date: string | null
  total_amount: number | string | null
}

export function isIssuedInvoice(status: string): boolean {
  return (ISSUED_INVOICE_STATUSES as readonly string[]).includes(status)
}

/** 期間内に発行した請求書（確定・送付済・入金済）の税込合計。発行日が空なら作成日で数える。 */
export function sumIssuedInvoices(invoices: ReadonlyArray<InvoiceLite>, r: DateRange): number {
  let s = 0
  for (const inv of invoices) {
    if (!isIssuedInvoice(inv.status)) continue
    if (!inRange(inv.issue_date ?? inv.created_date, r)) continue
    s += Number(inv.total_amount) || 0
  }
  return s
}

/**
 * 未請求額: 請求対象の明細（承認済み・出荷済みで納品日が今日まで）のうち、
 * 有効な請求書（無効以外）に載っていない明細の税込金額の合計。
 * 「今月出荷 − 今月請求」の引き算ではない（下書きを請求済み扱いしない・先月以前の請求漏れも拾う）。
 */
export function computeUnbilled(
  items: ReadonlyArray<{ id: string; line_total: number | string | null }>,
  billedIds: ReadonlySet<string>,
): { amount: number; count: number } {
  let amount = 0
  let count = 0
  for (const it of items) {
    if (billedIds.has(it.id)) continue
    const v = Number(it.line_total) || 0
    if (v <= 0) continue
    amount += v
    count++
  }
  return { amount, count }
}

// ---------------------------------------------------------------------------
// 箱数・進捗（すべて箱数基準に統一する）
// ---------------------------------------------------------------------------

/** 規格文字列から1箱あたりの入数を推定（既定20）。 */
export function resolveDashboardPpc(spec?: string | null): number {
  const s = (spec ?? '').normalize('NFKC')
  const m = s.match(/(?:入数|1箱|1ケース)\s*[:：]?\s*(\d+)|(\d+)\s*入(?:り)?/i)
  if (m) {
    const n = Number(m[1] || m[2])
    if (Number.isFinite(n) && n >= 10 && n <= 200) return n
  }
  if (s.includes('小コン')) return 30
  if (s.includes('24')) return 24
  return 20
}

export interface PackItem {
  field_status: string | null
  quantity: number | string | null
  shipped_qty?: number | string | null
  spec?: string | null
  line_total?: number | string | null
}

export function boxesOf(it: PackItem): number {
  const q = Number(it.quantity) || 0
  return q > 0 ? Math.ceil(q / resolveDashboardPpc(it.spec)) : 0
}

export function pctOf(done: number, total: number): number {
  if (!(total > 0)) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

/** 明日納品分のパック進捗。% は「完成箱数 ÷ 目標箱数」（画面の「11/30箱」と必ず一致させる）。 */
export function computePackProgress(items: ReadonlyArray<PackItem>): {
  totalItems: number
  completedItems: number
  totalBoxes: number
  completedBoxes: number
  totalPacks: number
  completedPacks: number
  progressPct: number
} {
  let totalBoxes = 0
  let completedBoxes = 0
  let totalPacks = 0
  let completedPacks = 0
  let completedItems = 0
  for (const it of items) {
    const q = Number(it.quantity) || 0
    const ppc = resolveDashboardPpc(it.spec)
    const boxes = boxesOf(it)
    totalPacks += q
    totalBoxes += boxes
    if (it.field_status === 'packed' || it.field_status === 'shipped') {
      completedItems++
      completedPacks += q
      completedBoxes += boxes
    } else if (Number(it.shipped_qty) > 0) {
      const partial = Math.min(q, Number(it.shipped_qty))
      completedPacks += partial
      completedBoxes += Math.floor(partial / ppc)
    }
  }
  return {
    totalItems: items.length,
    completedItems,
    totalBoxes,
    completedBoxes,
    totalPacks,
    completedPacks,
    progressPct: pctOf(completedBoxes, totalBoxes),
  }
}

/** 本日納品分の状況（未着手・梱包完了・出荷済み）を箱数と金額で。進捗率 = (梱包完了＋出荷済み)箱 ÷ 全箱。 */
export function computeTodayShipment(items: ReadonlyArray<PackItem>): {
  notStarted: number
  packed: number
  shipped: number
  totalBoxes: number
  doneBoxes: number
  progressPct: number
  totalItems: number
  itemCounts: { notStarted: number; packed: number; shipped: number }
  amounts: { notStarted: number; packed: number; shipped: number }
} {
  const boxes = { notStarted: 0, packed: 0, shipped: 0 }
  const counts = { notStarted: 0, packed: 0, shipped: 0 }
  const amounts = { notStarted: 0, packed: 0, shipped: 0 }
  for (const it of items) {
    const key = it.field_status === 'shipped' ? 'shipped' : it.field_status === 'packed' ? 'packed' : 'notStarted'
    boxes[key] += boxesOf(it)
    counts[key]++
    amounts[key] += Number(it.line_total) || 0
  }
  const totalBoxes = boxes.notStarted + boxes.packed + boxes.shipped
  const doneBoxes = boxes.packed + boxes.shipped
  return {
    ...boxes,
    totalBoxes,
    doneBoxes,
    progressPct: pctOf(doneBoxes, totalBoxes),
    totalItems: items.length,
    itemCounts: counts,
    amounts,
  }
}
