'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Image as ImageIcon, FileText, ChevronDown, ChevronUp, AlertCircle, Sparkles, Copy, PenLine, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { ConfidenceBar } from '@/components/admin/ConfidenceBar'
import { InboxReceiptActions } from '@/components/admin/InboxReceiptActions'
import { ChannelBadge, ReceiptStatusBadge } from '@/components/admin/InboxBadges'
import { formatJpDateTime, formatJpDateShort } from '@/lib/dates'
import type { InboxReceipt } from '@/lib/orders/inbox'

/** メールの差出人・件名・本文（raw_payload から取り出したもの）。 */
export interface InboxEmailInfo {
  from: string | null
  subject: string | null
  text: string | null
}

/**
 * 読み取り失敗の理由を日本語の要約にする（AI・通信の例外は英語のまま保存されていることがある）。
 * 元の文は折りたたみで別に出す。
 */
export function summarizeReceiptError(message: string): string {
  const m = message.toLowerCase()
  if (/quota|rate.?limit|429|resource.?exhausted|too many requests/.test(m))
    return 'AIの読み取りに失敗しました（原因: AIの1日の利用回数の上限）。しばらくしてから「もう一度読み取る」を押してください'
  if (/timeout|timed out|deadline|aborted/.test(m))
    return 'AIの読み取りに失敗しました（原因: 応答の時間切れ）。「もう一度読み取る」を押してください'
  if (/fetch failed|network|econn|enotfound|socket|503|502|unavailable|overloaded/.test(m))
    return 'AIの読み取りに失敗しました（原因: 通信エラー）。「もう一度読み取る」を押してください'
  if (/api.?key|permission|unauthori[sz]ed|forbidden|401|403/.test(m))
    return 'AIの読み取りに失敗しました（原因: AIの接続設定）。開発担当に連絡してください'
  if (/json|parse|unexpected token|schema/.test(m))
    return 'AIの読み取りに失敗しました（原因: AIの返事を読み取れない）。「もう一度読み取る」か、注文の受付で手入力してください'
  if (/safety|blocked|recitation/.test(m))
    return 'AIの読み取りに失敗しました（原因: AIが内容を扱えない）。注文の受付で手入力してください'
  // 英語だけの例外文は、そのまま出さずに要約する
  const cause = message.match(/原因[:：]\s*([\s\S]*?)）?$/)?.[1] ?? message.replace(/^[^:：]*[:：]\s*/, '')
  if (/^[\x00-\x7f]+$/.test(cause)) return 'AIの読み取りに失敗しました（原因: 不明なエラー）。「もう一度読み取る」を押してください'
  // モデル名などの開発用語は出さない
  return message.replace(/Gemini\s*(の)?/gi, 'AI$1')
}

/** 受信レコード（order_receipts）のカード。「読み取った明細を見る」で明細を開ける。 */
export function InboxReceiptCard({ receipt: r, email = null }: { receipt: InboxReceipt; email?: InboxEmailInfo | null }) {
  const [expanded, setExpanded] = useState(false)
  // 取引先が分からない受信は、本文を見て判断できるよう最初から本文を出す
  const [showBody, setShowBody] = useState(r.status === 'unmatched')
  const errorSummary = r.errorMessage ? summarizeReceiptError(r.errorMessage) : null

  async function copyBody() {
    if (!email?.text) return
    try {
      await navigator.clipboard.writeText(email.text)
      toast.success('本文をコピーしました。注文の受付の入力欄に貼り付けられます')
    } catch {
      toast.error('コピーできませんでした。本文を選んでコピーしてください')
    }
  }

  // senderDateKey (例: 0312345678_20261018) から電話番号を抽出
  const senderPhone =
    r.senderDateKey && !r.senderDateKey.startsWith('unknown')
      ? r.senderDateKey.split('_')[0]
      : null

  const totalQuantity = r.items.reduce((sum, it) => sum + it.quantity, 0)
  const firstItem = r.items[0]

  return (
    <Card className="space-y-3 transition-shadow hover:shadow-md">
      {/* 上部ヘッダー（常時表示） */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ChannelBadge channel={r.channel} />
            <ReceiptStatusBadge status={r.status} />
            {r.isRevision && (
              <span className="whitespace-nowrap rounded bg-warning-bg px-2 py-0.5 text-xs font-bold text-warning">
                再送（差分）
              </span>
            )}
            {senderPhone && (
              <span className="whitespace-nowrap rounded bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
                送信元: {senderPhone}
              </span>
            )}
            {r.slipNo && (
              <span className="whitespace-nowrap rounded bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
                伝票No: {r.slipNo}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {r.customerName ? (
              <span className="flex items-center gap-1.5 font-bold text-ink">
                <ColorDot color={r.customerColor} name={r.customerName} />
                {r.customerName}
              </span>
            ) : (
              <span className="text-xs font-bold text-alert">⚠️ どの取引先からの注文か分かりませんでした</span>
            )}

            {r.deliveryDate && (
              <span className="whitespace-nowrap rounded-lg bg-harvest-50 px-2.5 py-0.5 text-xs font-bold text-forest-800 border border-harvest-400">
                納品: {formatJpDateShort(r.deliveryDate)}
              </span>
            )}

            {r.destinationName && (
              <span className="break-words rounded-lg border border-trust-100 bg-trust-50 px-2.5 py-0.5 text-xs font-bold text-trust-700">
                納入先: {r.destinationName}
              </span>
            )}
          </div>

          {/* 品目サマリー */}
          {r.items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft pt-0.5">
              <span className="font-bold text-ink">
                {firstItem?.name} {totalQuantity > 0 ? `${totalQuantity}${firstItem?.unit ?? 'P'}` : ''}
                {r.items.length > 1 && ` 他${r.items.length - 1}件`}
              </span>
              {firstItem?.cases != null && (
                <span className="text-ink-faint">
                  （計 {r.items.reduce((sum, it) => sum + (it.cases ?? 0), 0)}箱 / {firstItem.containerType ?? 'コンテナ'}）
                </span>
              )}
            </div>
          )}

          {r.ocrConfidence != null && <ConfidenceBar value={r.ocrConfidence} />}

          {r.status === 'ai_failed' && r.errorMessage && errorSummary && (
            <div className="rounded-lg bg-alert-bg/60 p-2.5 text-xs text-alert">
              <p className="font-bold">{errorSummary}</p>
              {errorSummary !== r.errorMessage && (
                <details className="mt-1">
                  <summary className="flex min-h-10 cursor-pointer items-center text-ink-soft">くわしい内容（開発担当向け）</summary>
                  <p className="break-all font-mono text-ink-soft">{r.errorMessage}</p>
                </details>
              )}
            </div>
          )}
          {r.status === 'unmatched' && (
            <p className="text-xs text-ink-soft">
              差出人や本文を見て、注文なら「注文の受付」で取引先を選んで入力してください。注文でなければ「却下」で一覧から消せます。
            </p>
          )}
          {r.status === 'pending_ai' && <p className="text-xs text-ink-muted">AIが読み取り中、または順番待ちです。</p>}

          {/* メールの差出人・件名・本文（取引先が分からないときの判断材料） */}
          {email && (email.from || email.subject || email.text) && (
            <div className="space-y-1.5 rounded-lg border border-line bg-bg-soft p-2.5 text-xs">
              {email.from && (
                <p className="break-all text-ink-soft">
                  <Mail className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  差出人: <span className="font-bold text-ink">{email.from}</span>
                </p>
              )}
              {email.subject && (
                <p className="break-words text-ink-soft">
                  件名: <span className="font-bold text-ink">{email.subject}</span>
                </p>
              )}
              {email.text && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBody((v) => !v)}
                    aria-expanded={showBody}
                    className="inline-flex min-h-10 items-center gap-1 font-bold text-trust-700 hover:underline"
                  >
                    {showBody ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    )}
                    本文を{showBody ? 'たたむ' : '見る'}
                  </button>
                  {showBody && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-bg-card p-2.5 font-sans leading-relaxed text-ink">
                      {email.text}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}

          {/* AIアラート（数量変更・注意） */}
          {r.alerts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {r.alerts.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md bg-warning-bg border border-warning px-2 py-0.5 text-xs font-bold text-ink"
                >
                  <AlertCircle className="h-3 w-3" aria-hidden />
                  {a.message}
                </span>
              ))}
            </div>
          )}
        </div>
        <time className="num shrink-0 text-xs text-ink-faint">{formatJpDateTime(r.receivedAt)}</time>
      </div>

      {/* 詳細展開アコーディオン（詳細ボタンでスッと開く） */}
      {expanded && (
        <div className="animate-fade-in space-y-3 rounded-xl border border-line bg-bg-soft/70 p-3.5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-xs text-ink flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-forest-600" aria-hidden />
              <span>AIが読み取った明細</span>
            </h3>
            {r.hasR2Key && (
              <a
                href={`/api/receipts/${r.id}/original`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-10 items-center gap-1 text-xs font-bold text-trust-700 hover:underline"
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                原本を別の画面で開く ↗
              </a>
            )}
          </div>

          {r.items.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-line bg-bg-card shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-line bg-earth-50 text-ink-soft">
                  <tr>
                    <th className="px-3 py-2 font-bold">品目名</th>
                    <th className="px-3 py-2 font-bold">規格</th>
                    <th className="px-3 py-2 font-bold text-right">数量</th>
                    <th className="px-3 py-2 font-bold text-right">箱数</th>
                    <th className="px-3 py-2 font-bold">容器</th>
                    <th className="px-3 py-2 font-bold">納入先</th>
                    <th className="px-3 py-2 font-bold">納品日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.items.map((it, idx) => (
                    <tr key={idx} className="hover:bg-earth-50/50">
                      <td className="px-3 py-2 font-bold text-ink">
                        {it.name}
                        {it.isNewAddition && (
                          <span className="whitespace-nowrap ml-1 rounded bg-harvest-100 px-1 text-xs font-bold text-forest-800">
                            新規
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-soft">{it.spec ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                        {it.quantity} {it.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                        {it.cases != null ? `${it.cases}箱` : '—'}
                      </td>
                      <td className="px-3 py-2 text-ink-soft">{it.containerType ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-soft">{it.destinationName ?? r.destinationName ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-soft">
                        {it.deliveryDate ? formatJpDateShort(it.deliveryDate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-ink-faint py-2 text-center">
              まだ読み取っていないか、注文の明細が見つかりませんでした。
            </p>
          )}

          {/* 原本FAXのインラインプレビュー */}
          {r.hasR2Key && (
            <div className="rounded-lg border border-line bg-bg-card p-2">
              <p className="mb-1 text-xs font-bold text-ink-soft">原本（縮小）</p>
              <div className="flex justify-center bg-earth-100/50 rounded overflow-hidden max-h-64">
                <img
                  src={`/api/receipts/${r.id}/original`}
                  alt="FAX原本プレビュー"
                  className="object-contain max-h-64 w-auto"
                  loading="lazy"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 下部アクションボタンバー */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* 詳細展開ボタン */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-bg-card px-3 text-xs font-bold text-ink hover:bg-bg-soft active:scale-95 transition"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                <span>読み取った明細をたたむ</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                <span>読み取った明細を見る</span>
              </>
            )}
          </button>

          {r.hasR2Key && (
            <a
              href={`/api/receipts/${r.id}/original`}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              原本を見る
            </a>
          )}
          {/* 原本ファイルが無い（メール本文だけの）受信は、本文をコピーして注文の受付で入力する */}
          {!r.hasR2Key && !r.orderId && (r.status === 'unmatched' || r.status === 'ai_failed') && (
            <>
              {email?.text && (
                <button
                  type="button"
                  onClick={copyBody}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  本文をコピー
                </button>
              )}
              <Link
                href="/admin/orders/new"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-harvest-400 bg-harvest-50 px-3 text-xs font-bold text-harvest-700 hover:bg-harvest-100"
              >
                <PenLine className="h-3.5 w-3.5" aria-hidden />
                注文の受付で入力する
              </Link>
            </>
          )}
          {r.orderId && (
            <Link
              href={`/admin/orders/${r.orderId}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-trust-700 hover:bg-trust-50"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              受注を見る
            </Link>
          )}
        </div>

        <InboxReceiptActions receiptId={r.id} status={r.status} hasR2Key={r.hasR2Key} />
      </div>
    </Card>
  )
}
