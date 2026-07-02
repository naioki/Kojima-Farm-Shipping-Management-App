import Link from 'next/link'
import { Image as ImageIcon, FileText, ScanLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { ConfidenceBar } from '@/components/admin/ConfidenceBar'
import { IngestButton } from '@/components/admin/IngestButton'
import { InboxReceiptActions } from '@/components/admin/InboxReceiptActions'
import { ManualOcrForm } from '@/components/admin/ManualOcrForm'
import { getSetting } from '@/lib/settings'
import { DEFAULT_GEMINI_PROMPT_NORMAL } from '@/lib/gemini/prompts'

export const dynamic = 'force-dynamic'

const CHANNEL_LABEL: Record<string, string> = {
  fax: 'FAX',
  email: 'メール',
  portal: 'ポータル',
  manual: '手動',
}

/**
 * 受信トレイ（受注の取り込み拠点）。
 *  - 上部: 手動でファイル（FAX画像・PDF・メール本文）を読み取って注文化（旧「注文を読む」を統合）。
 *  - 下部: 自動で届いた受信の一覧。各カードに「読み取る」「再解析」「却下」。
 * 実際の承認は /admin/approvals（明細のある pending_review 注文のみ表示）。
 */
export default async function InboxPage() {
  const supabase = createClient()
  const { data: receipts, error } = await supabase
    .from('order_receipts')
    .select('id, channel, status, received_at, sender_date_key, is_revision, ocr_confidence, r2_key, order_id, customer_id, error_message')
    .in('status', ['pending_review', 'ai_failed', 'unmatched'])
    .order('received_at', { ascending: false })

  if (error) return <ErrorState message={error.message} />

  const customerIds = [...new Set((receipts ?? []).map((r) => r.customer_id).filter(Boolean))] as string[]
  const admin = createAdminClient()
  const [{ data: custs }, currentPrompt, ocrCustomersRes, productsRes, destinationsRes] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color: string | null }[] }),
    getSetting('GEMINI_PROMPT_NORMAL').then((v) => v ?? ''),
    admin.from('customers').select('id, name').eq('is_active', true).order('name'),
    admin.from('products').select('id, name').eq('is_active', true).order('name'),
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true)
      .order('sort_order'),
  ])
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))

  const ocrCustomers = (ocrCustomersRes.data ?? []) as { id: string; name: string }[]
  const products = (productsRes.data ?? []) as { id: string; name: string }[]
  const destinations = (destinationsRes.data ?? []) as {
    id: string
    customer_id: string
    code: string | null
    full_name: string
    aliases: string[]
  }[]

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
        </div>
        <IngestButton />
      </div>

      {/* 手動でファイルを読み取る（旧「注文を読む」を統合。折りたたみ・既定は閉じる） */}
      <details className="group rounded-lg border border-line bg-bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink hover:bg-bg-soft">
          <ScanLine className="h-4 w-4 text-earth-700" aria-hidden />
          手動でファイルを読み取る（FAX画像・PDF・メール本文）
          <span className="ml-auto text-xs text-ink-faint group-open:hidden">開く ＋</span>
          <span className="ml-auto hidden text-xs text-ink-faint group-open:inline">閉じる −</span>
        </summary>
        <div className="border-t border-line p-4">
          <ManualOcrForm
            currentPrompt={currentPrompt}
            defaultPrompt={DEFAULT_GEMINI_PROMPT_NORMAL}
            customers={ocrCustomers}
            products={products}
            destinations={destinations}
          />
        </div>
      </details>

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
