import Link from 'next/link'
import { Image as ImageIcon, FileText, ScanLine, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { ConfidenceBar } from '@/components/admin/ConfidenceBar'
import { IngestButton } from '@/components/admin/IngestButton'
import { InboxReceiptActions } from '@/components/admin/InboxReceiptActions'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

const CHANNEL_LABEL: Record<string, string> = {
  fax: 'FAX',
  email: 'メール',
  portal: 'ポータル',
  manual: '手動',
}

const ALL_STATUSES = ['pending_ai', 'pending_review', 'ai_failed', 'unmatched']
const STATUS_FILTER_LABEL: Record<string, string> = {
  pending_ai: '解析待ち',
  pending_review: '要確認',
  ai_failed: '解析失敗',
  unmatched: '未紐付け',
}

/**
 * 受信トレイ（受注の取り込み拠点）。
 *  - 上部: 手動でファイル（FAX画像・PDF・メール本文）を読み取って注文化（旧「注文を読む」を統合）。
 *  - 下部: 自動で届いた受信の一覧。各カードに「読み取る」「再解析」「却下」。
 * ?status=ai_failed,unmatched でダッシュボードの「解析失敗・未紐付け」アラートから絞り込んで開ける。
 * 実際の承認は /admin/approvals（明細のある pending_review 注文のみ表示）。
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  const guard = await requireAdmin('受信トレイは管理者のみです。')
  if (guard) return guard

  const requested = searchParams.status?.split(',').filter((s) => ALL_STATUSES.includes(s)) ?? []
  const statusFilter = requested.length ? requested : ALL_STATUSES

  const supabase = createClient()
  const { data: receipts, error } = await supabase
    .from('order_receipts')
    .select('id, channel, status, received_at, sender_date_key, is_revision, ocr_confidence, r2_key, order_id, customer_id, error_message')
    .in('status', statusFilter)
    .order('received_at', { ascending: false })

  if (error) return <ErrorState message={error.message} />

  const customerIds = [...new Set((receipts ?? []).map((r) => r.customer_id).filter(Boolean))] as string[]
  const { data: custs } = customerIds.length
    ? await supabase.from('customers').select('id, name, display_color').in('id', customerIds)
    : { data: [] as { id: string; name: string; display_color: string | null }[] }
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">受信トレイ</h1>
          <p className="mt-1 text-sm text-ink-soft">
            届いたFAX・メールの取り込み拠点。「読み取る」で注文化、「却下」でリストから削除。
            承認は
            <Link href="/admin/approvals" className="text-trust-600 hover:underline">
              注文の承認
            </Link>
            で。
          </p>
          {requested.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-faint">
              絞り込み中（{requested.map((s) => STATUS_FILTER_LABEL[s] ?? s).join('・')}）
              <Link href="/admin/inbox" className="ml-1.5 text-trust-600 hover:underline">
                すべて表示
              </Link>
            </p>
          )}
        </div>
        <IngestButton />
      </div>

      {/* 手動でファイルを読み取る（読み取りフォーム本体は /admin/ocr に一本化。ここは導線のみ） */}
      <Link
        href="/admin/ocr"
        className="flex items-center gap-2 rounded-lg border border-line bg-bg-card px-4 py-3 text-sm font-medium text-ink hover:bg-bg-soft"
      >
        <ScanLine className="h-4 w-4 text-earth-700" aria-hidden />
        手動でファイルを読み取る（FAX画像・PDF・メール本文）
        <ChevronRight className="ml-auto h-4 w-4 text-ink-faint" aria-hidden />
      </Link>

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
                        {r.status === 'pending_ai' && (
                          <span className="inline-flex items-center gap-1 rounded bg-trust-100 px-2 py-0.5 text-xs font-medium text-trust-700">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-trust-500" aria-hidden />
                            解析待ち
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
                        <p className="rounded bg-alert-bg/60 px-2 py-1 text-xs text-alert">{r.error_message}</p>
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
                    {r.order_id && (
                      <Link
                        href={`/admin/orders/${r.order_id}`}
                        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-trust-700 hover:bg-trust-50"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                        受注を見る
                      </Link>
                    )}
                    <InboxReceiptActions
                      receiptId={r.id}
                      status={r.status}
                      hasR2Key={Boolean(r.r2_key)}
                    />
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
