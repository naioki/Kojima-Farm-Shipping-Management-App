import Link from 'next/link'
import { ChevronRight, Truck, FileDown, Building2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { DeliveryNoteForm } from '@/components/admin/DeliveryNoteForm'
import { getSetting } from '@/lib/settings'
import { formatYen } from '@/lib/calculations/tax'
import { parseAmountMode, amountModeLabel } from '@/lib/delivery-notes/amount-mode'
import { formatJpDateShort, jstTodayStr, shiftDateStr } from '@/lib/dates'
import {
  isDriverDeliveryNoteCustomer,
  resolveDefaultIssuerPreset,
  resolveIssuerCompanyName,
} from '@/lib/delivery-notes/driver-note'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 納品書（出荷ごとの伝票）。取引先×納品日でその日の明細から伝票を生成・発行する。
 * 「発行して保存」した納品書は履歴として残り、後から再印刷・確認できる（発行時スナップショット）。
 */
export default async function DeliveryNotesPage({
  searchParams,
}: {
  searchParams?: { date?: string }
}) {
  const guard = await requireAdmin('納品書は管理者のみです。')
  if (guard) return guard

  const defaultDate = shiftDateStr(jstTodayStr(), 1)
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date ?? '') ? searchParams!.date! : defaultDate

  const supabase = createAdminClient()
  const [
    { data: customers, error },
    { data: notes },
    { data: dayOrders },
    { count: pendingCount },
    amountModeSetting,
  ] = await Promise.all([
    supabase.from('customers').select('id, name, channel_identifiers').eq('is_active', true).order('name'),
    supabase
      .from('delivery_notes')
      .select('id, note_number, customer_name, delivery_date, amount_mode, total_amount, issued_at')
      .order('issued_at', { ascending: false })
      .limit(50),
    supabase
      .from('orders')
      .select('id, customer_id')
      .eq('delivery_date', targetDate)
      .in('status', ['approved', 'shipped', 'invoiced']),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    getSetting('DELIVERY_NOTE_AMOUNT_MODE'),
  ])
  if (error) return <ErrorState message={error.message} />
  const defaultMode = parseAmountMode(amountModeSetting)

  const activeDayCustIds = new Set((dayOrders ?? []).map((o) => o.customer_id))
  const driverNoteCustomers = (customers ?? []).filter(
    (c) =>
      isDriverDeliveryNoteCustomer(c.name, (c as { channel_identifiers?: Record<string, unknown> | null }).channel_identifiers) &&
      activeDayCustIds.has(c.id),
  )
  const allDriverMasters = (customers ?? []).filter((c) =>
    isDriverDeliveryNoteCustomer(c.name, (c as { channel_identifiers?: Record<string, unknown> | null }).channel_identifiers),
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">納品書</h1>

      {(pendingCount ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning bg-warning-bg px-3.5 py-2.5 text-xs font-bold text-ink">
          <span>
            ⚠️ 未承認（確認待ち）の注文が <strong className="font-black underline">{pendingCount}件</strong> あります（承認すると納品書に反映されます）
          </span>
          <Link
            href="/admin/orders?status=pending_review"
            className="rounded-lg bg-warning px-2.5 py-1 text-xs font-black text-white hover:bg-warning"
          >
            確認待ちを開く →
          </Link>
        </div>
      )}

      {/* 🚚 運転手渡し納品書（勘兵衛・オレンジファーム等）クイック印刷 */}
      <div className="rounded-2xl border-2 border-harvest-600/30 bg-harvest-50/70 p-4 space-y-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-harvest-700 text-white shadow-2xs">
              <Truck className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="font-display text-base font-black text-forest-900">
                運転手渡し納品書（勘兵衛・オレンジファーム）
              </h2>
              <p className="text-xs text-forest-900/80">
                A4上下2連（切るとA5×2枚：納品書＋控）・金額なし・箱数明記・FAX着日自動印字
              </p>
            </div>
          </div>
          {driverNoteCustomers.length > 0 && (
            <a
              href={`/api/delivery-notes/pdf?customers=${driverNoteCustomers.map((c) => c.id).join(',')}&date=${targetDate}&amount=none&layout=2up`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-harvest-700 px-3.5 text-xs font-black text-white shadow-sm hover:bg-forest-800 transition"
            >
              <FileDown className="h-4 w-4" />
              <span>{formatJpDateShort(targetDate)}分（{driverNoteCustomers.length}社）をまとめてPDF印刷</span>
            </a>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2">
          {(driverNoteCustomers.length > 0 ? driverNoteCustomers : allDriverMasters).map((c) => {
            const preset = resolveDefaultIssuerPreset(
              c.name,
              (c as { channel_identifiers?: Record<string, unknown> | null }).channel_identifiers,
            )
            const issuerLabel = resolveIssuerCompanyName(preset, '小島農園')
            const altPreset = preset === 'iplus' ? 'kojima' : 'iplus'
            const altLabel = altPreset === 'iplus' ? 'アイプラス名義' : '小島農園名義'
            const hasOrderOnTarget = activeDayCustIds.has(c.id)
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-harvest-400 bg-white px-3.5 py-2.5 shadow-2xs"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-sm text-ink">{c.name}</span>
                  <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-md bg-harvest-100 border border-harvest-400 px-2 py-0.5 text-xs font-bold text-forest-900">
                    <Building2 className="h-3 w-3" />
                    既定：{issuerLabel}
                  </span>
                  {hasOrderOnTarget ? (
                    <span className="whitespace-nowrap rounded-full bg-harvest-700 px-2 py-0.5 text-xs font-bold text-white">
                      {formatJpDateShort(targetDate)} 出荷あり
                    </span>
                  ) : (
                    <span className="text-xs text-ink-faint">（下のフォームで日付を選択できます）</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link
                    href={`/admin/delivery-notes/view?customer=${c.id}&date=${targetDate}&amount=none&issuer=${preset}&layout=2up`}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-harvest-700 px-3 text-xs font-bold text-white hover:bg-forest-800"
                  >
                    プレビュー（{preset === 'iplus' ? 'アイプラス' : '小島農園'}）
                  </Link>
                  <Link
                    href={`/admin/delivery-notes/view?customer=${c.id}&date=${targetDate}&amount=none&issuer=${altPreset}&layout=2up`}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-bg-soft px-2.5 text-xs font-bold text-ink-soft hover:bg-earth-50 hover:text-ink"
                  >
                    {altLabel}で開く
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">納品書を発行</h2>
        <DeliveryNoteForm
          customers={(customers ?? []).map((c) => ({ id: c.id, name: c.name }))}
          defaultMode={defaultMode}
        />
        <p className="text-sm text-ink-faint">
          選んだ取引先・納品日のその日の明細をまとめて1枚の納品書にします。プレビューで「発行して保存」を押すと
          履歴に残り、後から再印刷・確認できます。金額表示（金額あり／後から手書き／金額なし）は発行ごとに
          切り替えでき、既定は設定で変更できます。
        </p>
      </Card>

      <div className="space-y-2">
        <h2 className="font-display text-base font-bold text-ink">発行済みの履歴</h2>
        {!notes?.length ? (
          <EmptyState
            title="まだ発行された納品書はありません"
            description="上のフォームでプレビューを開き「発行して保存」を押すと、ここに履歴が残ります。"
          />
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <Link key={n.id} href={`/admin/delivery-notes/${n.id}`}>
                <Card variant="elevated" interactive className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num font-bold text-ink">{n.note_number}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {n.customer_name}・納品 {formatJpDateShort(n.delivery_date)}
                      <span className="whitespace-nowrap ml-2 rounded-full bg-bg-soft px-2 py-0.5 text-xs text-ink-faint">
                        {amountModeLabel(parseAmountMode(n.amount_mode))}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {n.amount_mode === 'full' && (
                      <span className="num font-bold tabular-nums text-ink">{formatYen(n.total_amount)}</span>
                    )}
                    <ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
