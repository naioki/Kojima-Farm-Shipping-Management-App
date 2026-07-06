import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { notify } from '@/lib/notify'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import {
  buildCanonicalizer,
  compareShadowLines,
  formatShadowReport,
  type ShadowDiffResult,
  type ShadowLine,
} from '@/lib/shadow/diff'

/**
 * 影実行ランナー（フェーズ2C）: 指定日について
 *   v4（現行本番）の確定注文  vs  本アプリの読み取り結果（承認済み注文＋要確認の解析結果）
 * を突合し、差分レポートを通知（Discord/LINE WORKS）する。
 *
 * - v4 への接続情報は設定（V4_SUPABASE_URL / V4_SUPABASE_SERVICE_KEY）。未設定なら何もしない
 *   （＝影実行のON/OFFは設定で切替。デプロイ不要）。
 * - 対象の取引先は SHADOW_DIFF_CUSTOMER（既定「ヨーク」）。v4がカバーする業務範囲だけを比べ、
 *   本アプリ固有の取引先（サンデーマート等）を誤差分として出さない。
 * - 本アプリ側は自動承認しない前提（切替日まで）。要確認のまま止まった解析結果
 *   （order_receipts.raw_payload.parsed_orders）も突合対象に含める。
 */

export interface ShadowRunResult {
  date: string
  skipped?: string
  error?: string
  v4Lines?: number
  appLines?: number
  result?: ShadowDiffResult
  report?: string
}

export async function runShadowDiff(date: string): Promise<ShadowRunResult> {
  const [v4Url, v4Key, customerNameSetting] = await Promise.all([
    getSetting('V4_SUPABASE_URL'),
    getSetting('V4_SUPABASE_SERVICE_KEY'),
    getSetting('SHADOW_DIFF_CUSTOMER'),
  ])
  if (!v4Url || !v4Key) {
    return { date, skipped: 'V4_SUPABASE_URL / V4_SUPABASE_SERVICE_KEY 未設定（影実行OFF）' }
  }
  const targetCustomerName = (customerNameSetting ?? '').trim() || 'ヨーク'

  // ── v4 側: 確定注文明細 ─────────────────────────────────────────────
  const v4 = createSupabaseClient(v4Url, v4Key, { auth: { persistSession: false } })

  const { data: v4Orders, error: v4OrdersErr } = await v4
    .from('orders')
    .select('id')
    .eq('order_date', date)
    .neq('status', 'cancelled')
  if (v4OrdersErr) return { date, error: `v4接続エラー: ${v4OrdersErr.message}` }

  const v4OrderIds = (v4Orders ?? []).map((o) => o.id as string)
  const v4Lines: ShadowLine[] = []
  if (v4OrderIds.length > 0) {
    const { data: lines, error: linesErr } = await v4
      .from('order_lines')
      .select('customer_id, product_standard_id, total_qty')
      .in('order_id', v4OrderIds)
    if (linesErr) return { date, error: `v4明細取得エラー: ${linesErr.message}` }

    const custIds = [...new Set((lines ?? []).map((l) => l.customer_id as string).filter(Boolean))]
    const psIds = [...new Set((lines ?? []).map((l) => l.product_standard_id as string).filter(Boolean))]
    const [{ data: v4Custs }, { data: v4Ps }] = await Promise.all([
      custIds.length ? v4.from('customers').select('id, name').in('id', custIds) : Promise.resolve({ data: [] }),
      psIds.length
        ? v4.from('product_standards').select('id, products(name)').in('id', psIds)
        : Promise.resolve({ data: [] }),
    ])
    const storeName = new Map((v4Custs ?? []).map((c) => [c.id as string, c.name as string]))
    const productName = new Map(
      (v4Ps ?? []).map((p) => {
        const prod = p.products as { name?: string } | null
        return [p.id as string, prod?.name ?? '']
      }),
    )
    for (const l of lines ?? []) {
      v4Lines.push({
        store: storeName.get(l.customer_id as string) ?? '',
        item: productName.get(l.product_standard_id as string) ?? '',
        totalQty: Number(l.total_qty ?? 0),
      })
    }
  }

  // ── 本アプリ側: 対象取引先の 承認済み注文 ＋ 未注文化の解析結果 ────────────
  const admin = createAdminClient()

  const { data: customer } = await admin
    .from('customers')
    .select('id')
    .eq('name', targetCustomerName)
    .maybeSingle()
  if (!customer) return { date, error: `取引先「${targetCustomerName}」が本アプリに未登録です` }

  const { data: dests } = await admin
    .from('delivery_destinations')
    .select('code, full_name, aliases')
    .eq('customer_id', customer.id)
  // 納入先名の正規化（code/aliases → full_name）。v4店舗名との文字列一致を安定させる
  const destMap = new Map<string, string>()
  for (const d of dests ?? []) {
    destMap.set((d.full_name as string).trim(), d.full_name as string)
    if (d.code) destMap.set((d.code as string).trim(), d.full_name as string)
    for (const a of (d.aliases as string[] | null) ?? []) destMap.set(a.trim(), d.full_name as string)
  }
  const canonStore = (s: string) => destMap.get(s.trim()) ?? s.trim()

  const appLines: ShadowLine[] = []

  // a) 承認済み注文（手動・自動を問わず本アプリに存在する注文）
  const { data: appOrders } = await admin
    .from('orders')
    .select('id, destination_id')
    .eq('customer_id', customer.id)
    .eq('delivery_date', date)
  const appOrderIds = (appOrders ?? []).map((o) => o.id as string)
  if (appOrderIds.length > 0) {
    const destIds = [...new Set((appOrders ?? []).map((o) => o.destination_id).filter(Boolean))] as string[]
    const { data: destRows } = destIds.length
      ? await admin.from('delivery_destinations').select('id, code, full_name').in('id', destIds)
      : { data: [] as { id: string; code: string | null; full_name: string }[] }
    const destName = new Map((destRows ?? []).map((d) => [d.id, d.full_name]))
    const orderDest = new Map((appOrders ?? []).map((o) => [o.id as string, o.destination_id as string | null]))

    const { data: items } = await admin
      .from('order_items')
      .select('order_id, product_name, quantity')
      .in('order_id', appOrderIds)
    for (const it of items ?? []) {
      const destId = orderDest.get(it.order_id as string)
      appLines.push({
        store: canonStore(destId ? (destName.get(destId) ?? '') : ''),
        item: it.product_name as string,
        totalQty: Number(it.quantity ?? 0),
      })
    }
  }

  // b) 注文化されず要確認で止まっている解析結果（影実行の主対象）
  const { data: receipts } = await admin
    .from('order_receipts')
    .select('raw_payload, order_id')
    .eq('channel', 'email')
    .eq('customer_id', customer.id)
    .in('status', ['pending_review', 'unmatched'])
    .is('order_id', null)
  for (const r of receipts ?? []) {
    const payload = r.raw_payload as { parsed_orders?: unknown } | null
    const orders = Array.isArray(payload?.parsed_orders) ? payload!.parsed_orders : []
    for (const o of orders as Array<{
      delivery_date?: string | null
      destination_name?: string | null
      items?: Array<{ raw_name?: string; product_name?: string | null; quantity?: string }>
    }>) {
      if (o.delivery_date !== date) continue
      for (const it of o.items ?? []) {
        const q = parseQuantity(it.quantity ?? '', { packsPerCase: null })
        appLines.push({
          store: canonStore(o.destination_name ?? ''),
          item: (it.product_name || it.raw_name || '').trim(),
          totalQty: q.type === 'ok' ? q.total.toNumber() : null,
        })
      }
    }
  }

  // v4側の店舗名にも同じ正規化をかけ、品目は products.aliases で正規化して突合
  const { data: products } = await admin.from('products').select('name, aliases')
  const canonItem = buildCanonicalizer(
    (products ?? []).map((p) => ({ name: p.name as string, aliases: p.aliases as string[] | null })),
  )
  const result = compareShadowLines(
    v4Lines.map((l) => ({ ...l, store: canonStore(l.store) })),
    appLines,
    canonItem,
  )
  const report = formatShadowReport(date, result)

  await notify({
    event: 'shadow_diff',
    level: result.diffs.length === 0 ? 'info' : 'warning',
    title: `影実行レポート（${targetCustomerName}・${date}）`,
    body: report,
    url: '/admin/inbox',
  }).catch(() => {})

  return { date, v4Lines: v4Lines.length, appLines: appLines.length, result, report }
}
