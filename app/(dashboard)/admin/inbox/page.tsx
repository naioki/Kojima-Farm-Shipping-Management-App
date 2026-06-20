import Link from 'next/link'
import { Image as ImageIcon, FileText, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { ConfidenceBar } from '@/components/admin/ConfidenceBar'

export const dynamic = 'force-dynamic'

const CHANNEL_LABEL: Record<string, string> = {
  fax: 'FAX',
  email: 'メール',
  portal: 'ポータル',
  manual: '手動',
}

/**
 * 承認待ち一覧（features.md Phase C）。受信ログのうち要対応ステータスを表示する。
 * 確信度バー・原本プレビュー（R2署名URL）・生成された注文への導線を提供する。
 * ※ 実際の承認は注文側（/admin/approvals・受注詳細）で行う（受信→注文化は取り込みが担当）。
 */
export default async function InboxPage() {
  const supabase = createClient()
  const { data: receipts, error } = await supabase
    .from('order_receipts')
    .select('id, channel, status, received_at, sender_date_key, is_revision, ocr_confidence, r2_key, order_id, customer_id, error_message')
    .in('status', ['pending_review', 'ai_failed', 'unmatched'])
    .order('received_at', { ascending: false })

  if (error) return <ErrorState message={error.message} />

  // 取引先名（紐付け済みのものだけ）
  const customerIds = [...new Set((receipts ?? []).map((r) => r.customer_id).filter(Boolean))] as string[]
  const { data: custs } = customerIds.length
    ? await supabase.from('customers').select('id, name, display_color').in('id', customerIds)
    : { data: [] as { id: string; name: string; display_color: string | null }[] }
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">承認待ち（受信）</h1>
        <p className="mt-1 text-sm text-ink-soft">
          取り込んだ受信の確認。承認は受注一覧・
          <Link href="/admin/approvals" className="text-trust-600 hover:underline">
            注文の承認
          </Link>
          で行います。
        </p>
      </div>

      {!receipts?.length ? (
        <EmptyState title="承認待ちはありません" description="新しい受信があるとここに表示されます。" />
      ) : (
        <ul className="stagger space-y-3">
          {receipts.map((r) => {
            const name = r.customer_id ? custName.get(r.customer_id) : null
            return (
              <li key={r.id}>
                <Card className="space-y-2.5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-earth-100 px-2 py-0.5 text-xs font-medium text-earth-800">
                          {CHANNEL_LABEL[r.channel] ?? r.channel}
                        </span>
                        {r.is_revision && (
                          <span className="rounded bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
                            再送（差分）
                          </span>
                        )}
                        {r.status === 'unmatched' && (
                          <span className="rounded bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">
                            未紐付け
                          </span>
                        )}
                        {r.status === 'ai_failed' && (
                          <span className="rounded bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">
                            解析失敗
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {name ? (
                          <span className="flex items-center gap-1.5 font-medium text-ink">
                            <ColorDot color={custColor.get(r.customer_id!)} name={name} />
                            {name}
                          </span>
                        ) : (
                          <span className="text-ink-faint">取引先 未紐付け</span>
                        )}
                        <span className="num text-ink-soft">{r.sender_date_key ?? '—'}</span>
                      </div>
                      <ConfidenceBar value={r.ocr_confidence != null ? Number(r.ocr_confidence) : null} />
                      {r.status === 'ai_failed' && r.error_message && (
                        <p className="text-xs text-alert">{r.error_message}</p>
                      )}
                    </div>
                    <time className="num shrink-0 text-xs text-ink-faint">
                      {new Date(r.received_at).toLocaleString('ja-JP')}
                    </time>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-2.5">
                    {r.r2_key && (
                      <a
                        href={`/api/receipts/${r.id}/original`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-bg-soft"
                      >
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                        原本を見る
                      </a>
                    )}
                    {r.order_id ? (
                      <Link
                        href={`/admin/orders/${r.order_id}`}
                        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-trust-700 hover:bg-trust-50"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                        受注を見る
                      </Link>
                    ) : (
                      <Link
                        href="/admin/approvals"
                        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-harvest-700 hover:bg-harvest-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        承認へ
                      </Link>
                    )}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
