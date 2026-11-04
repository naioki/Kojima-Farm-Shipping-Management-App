import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { ErrorState } from '@/components/ui/States'
import { ShipmentAddForm, type CustomerProductRuleSummary } from '@/components/field/ShipmentAddForm'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { requireAdmin } from '@/lib/auth/require-admin'
import { loadReceiptAttachment } from '@/lib/ocr/receipt-original'

export const dynamic = 'force-dynamic'

/**
 * 注文の受付（電話・LINE・紙・写真）。
 * 入力フォームは現場の「追加」と同じ ShipmentAddForm に一本化している（2つあったフォームの重複を解消）。
 * - 写真・画像の貼り付け（Ctrl+V）・ドラッグ＆ドロップ・LINE文面の貼り付けを AI で読み取り
 * - 受注経路（電話・LINE・紙）は入力の種類から自動推定し、画面上部で選び直せる
 */
export default async function OrderNewPage({ searchParams }: { searchParams: { receipt?: string } }) {
  const guard = await requireAdmin('注文入力は管理者のみアクセスできます。')
  if (guard) return guard

  // 受信ボックスの「読み取る」から来た場合は、その受信の原本を添付した状態で開く
  const receiptId = /^[0-9a-f-]{36}$/i.test(searchParams.receipt ?? '') ? searchParams.receipt! : null
  const fromReceipt = receiptId ? await loadReceiptAttachment(receiptId) : null

  // RLSによるマスタ取得漏れを防ぐため createAdminClient() を使用（GEMINI.md §1）
  const admin = createAdminClient()
  const [customersRes, productsRes, rulesRes, destinationsRes] = await Promise.all([
    admin.from('customers').select('id, name, channel_identifiers').eq('is_active', true).order('name'),
    admin
      .from('products')
      .select('id, name, unit, category')
      .eq('is_active', true)
      .order('category', { nullsFirst: false })
      .order('name'),
    admin
      .from('customer_product_rules')
      .select('customer_id, product_id, packs_per_case, container_type, spec, label_spec, has_card'),
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, default_container_type')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  // マスタ取得の失敗を「空」に化けさせない（CLAUDE.md）
  const masterErr = customersRes.error ?? productsRes.error ?? rulesRes.error ?? destinationsRes.error
  if (masterErr) {
    return (
      <ErrorState message="マスタデータを読み込めませんでした。時間をおいて再度お試しください。" detail={masterErr.message} />
    )
  }

  const packsByPair: Record<string, number | null> = {}
  const rulesByPair: Record<string, CustomerProductRuleSummary> = {}
  for (const r of rulesRes.data ?? []) {
    const key = `${r.customer_id}:${r.product_id}`
    const rec = r as Record<string, unknown>
    const ppc = r.packs_per_case != null ? Number(r.packs_per_case) : null
    packsByPair[key] = ppc
    rulesByPair[key] = {
      packsPerCase: ppc,
      spec: (typeof rec.spec === 'string' && rec.spec) || r.label_spec || null,
      containerType: r.container_type ?? null,
      hasCard: typeof rec.has_card === 'boolean' ? rec.has_card : null,
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          ダッシュボードへ
        </Link>
        <Link href="/admin/orders" className="text-xs font-medium text-trust-600 hover:underline">
          受注一覧を見る →
        </Link>
      </div>
      {receiptId && !fromReceipt?.attachment && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          受信ボックスの原本を取り出せませんでした。お手数ですが、原本の画像・PDFを下の欄に貼り付けるかドロップしてください。
        </p>
      )}
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">注文の受付</h1>
        <p className="text-sm text-ink-soft">
          LINEの文面や画像は下の欄に貼り付け（Ctrl+V）、写真・PDF・Excelはドラッグ＆ドロップかボタンから。AIが読み取って明細にします。
        </p>
      </div>
      <ShipmentAddForm
        deliveryDate={shiftDateStr(jstTodayStr(), 1)}
        customers={(customersRes.data ?? []).map((c) => {
          const ci = c.channel_identifiers as { aliases?: unknown } | null
          return { id: c.id, name: c.name, aliases: Array.isArray(ci?.aliases) ? (ci!.aliases as string[]) : null }
        })}
        products={(productsRes.data ?? []).map((p) => ({ id: p.id, name: p.name, unit: p.unit, category: p.category }))}
        destinations={(destinationsRes.data ?? []).map((d) => ({
          id: d.id,
          customerId: d.customer_id ?? '',
          label: d.code?.trim() || d.full_name,
          defaultContainerType: (d as { default_container_type?: string | null }).default_container_type ?? null,
        }))}
        packsByPair={packsByPair}
        rulesByPair={rulesByPair}
        initialAttachment={fromReceipt?.attachment ?? null}
        fixedIntakeChannel={fromReceipt?.channel ?? null}
      />
    </div>
  )
}
