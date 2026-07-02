import Link from 'next/link'
import { Camera, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { SpecReportActions } from '@/components/admin/SpecReportActions'
import { getReceiptSignedUrl } from '@/lib/r2'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 規格報告の確認（管理者）。現場からの「規格が変わったかも」報告を一覧し、
 * 対応済み/却下にする。実際のマスタ反映は取引先ページの規格編集で行う（直接編集はガバナンス下）。
 */
export default async function SpecReportsPage() {
  const guard = await requireAdmin('規格報告の確認は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()

  const { data: reports, error } = await supabase
    .from('spec_reports')
    .select('id, customer_id, product_id, note, photo_url, status, reported_by, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) return <ErrorState message={error.message} />

  // 取引先・商品・報告者名を解決
  const customerIds = [...new Set((reports ?? []).map((r) => r.customer_id).filter(Boolean))] as string[]
  const productIds = [...new Set((reports ?? []).map((r) => r.product_id).filter(Boolean))] as string[]
  const reporterIds = [...new Set((reports ?? []).map((r) => r.reported_by).filter(Boolean))] as string[]
  const [{ data: custs }, { data: prods }, { data: reporters }] = await Promise.all([
    customerIds.length ? supabase.from('customers').select('id, name').in('id', customerIds) : Promise.resolve({ data: [] }),
    productIds.length ? supabase.from('products').select('id, name').in('id', productIds) : Promise.resolve({ data: [] }),
    reporterIds.length ? supabase.from('users').select('id, full_name, email').in('id', reporterIds) : Promise.resolve({ data: [] }),
  ])
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const prodName = new Map((prods ?? []).map((p) => [p.id, p.name]))
  const reporterName = new Map((reporters ?? []).map((u) => [u.id, u.full_name || u.email || '不明']))

  // 写真の署名URL（R2未設定なら null）
  const photoUrls = new Map<string, string>()
  await Promise.all(
    (reports ?? [])
      .filter((r) => r.photo_url)
      .map(async (r) => {
        try {
          photoUrls.set(r.id, await getReceiptSignedUrl(r.photo_url as string))
        } catch {
          /* R2 未設定などは写真なし表示 */
        }
      }),
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">規格の報告（現場から）</h1>
      </div>

      {!reports?.length ? (
        <EmptyState title="未対応の報告はありません" description="現場から規格変更の報告が届くとここに表示されます。" />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const photo = photoUrls.get(r.id)
            return (
              <Card key={r.id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {r.customer_id ? (custName.get(r.customer_id) ?? '（不明な取引先）') : '取引先 未指定'}
                      {r.product_id && (
                        <span className="ml-2 text-sm text-ink-soft">/ {prodName.get(r.product_id) ?? '（不明な商品）'}</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {reporterName.get(r.reported_by ?? '') ?? '不明'}・{new Date(r.created_at).toLocaleString('ja-JP')}
                    </p>
                  </div>
                  {r.customer_id && (
                    <Link
                      href={`/admin/customers/${r.customer_id}`}
                      className="inline-flex shrink-0 items-center gap-0.5 text-xs text-trust-600 hover:underline"
                    >
                      規格を編集 <ChevronRight className="h-3 w-3" aria-hidden />
                    </Link>
                  )}
                </div>

                <p className="whitespace-pre-wrap rounded bg-bg-soft px-3 py-2 text-sm text-ink">{r.note}</p>

                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="報告写真" className="max-h-72 rounded-lg border border-line" />
                )}

                <SpecReportActions reportId={r.id} />
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
