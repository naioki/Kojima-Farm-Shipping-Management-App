import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'

export const dynamic = 'force-dynamic'

const CHANNEL_LABEL: Record<string, string> = {
  fax: 'FAX',
  email: 'メール',
  portal: 'ポータル',
  manual: '手動',
}

/**
 * 承認待ち一覧（features.md Phase C）。受信ログのうち要対応ステータスを表示する。
 * 差分ハイライト・確信度バー・ワンタップ承認は後続で各行コンポーネントに実装する。
 */
export default async function InboxPage() {
  const supabase = createClient()
  const { data: receipts, error } = await supabase
    .from('order_receipts')
    .select('id, channel, status, received_at, sender_date_key, is_revision, ocr_confidence')
    .in('status', ['pending_review', 'ai_failed', 'unmatched'])
    .order('received_at', { ascending: false })

  if (error) return <ErrorState message={error.message} />

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">承認待ち</h1>

      {!receipts?.length ? (
        <EmptyState title="承認待ちはありません" description="新しい受信があるとここに表示されます。" />
      ) : (
        <ul className="stagger space-y-3">
          {receipts.map((r) => (
            <li key={r.id}>
              <Card interactive className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
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
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{r.sender_date_key ?? '—'}</p>
                </div>
                <time className="num text-xs text-ink-faint">
                  {new Date(r.received_at).toLocaleString('ja-JP')}
                </time>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
