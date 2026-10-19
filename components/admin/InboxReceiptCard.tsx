'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Image as ImageIcon, FileText, ChevronDown, ChevronUp, AlertCircle, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { ConfidenceBar } from '@/components/admin/ConfidenceBar'
import { InboxReceiptActions } from '@/components/admin/InboxReceiptActions'
import { ChannelBadge, ReceiptStatusBadge } from '@/components/admin/InboxBadges'
import { formatJpDateTime, formatJpDateShort } from '@/lib/dates'
import type { InboxReceipt } from '@/lib/orders/inbox'
import { cn } from '@/lib/cn'

/** 受信レコード（order_receipts）のカード。「詳細を見る ▼」でアコーディオン展開可能。 */
export function InboxReceiptCard({ receipt: r }: { receipt: InboxReceipt }) {
  const [expanded, setExpanded] = useState(false)

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
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ChannelBadge channel={r.channel} />
            <ReceiptStatusBadge status={r.status} />
            {r.isRevision && (
              <span className="rounded bg-warning-bg px-2 py-0.5 text-xs font-bold text-warning">
                再送（差分）
              </span>
            )}
            {senderPhone && (
              <span className="rounded bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
                送信元: {senderPhone}
              </span>
            )}
            {r.slipNo && (
              <span className="rounded bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
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
              <span className="text-xs font-bold text-alert">⚠️ 取引先が未紐付けです（マスタ照合が必要）</span>
            )}

            {r.deliveryDate && (
              <span className="rounded-lg bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                納品: {formatJpDateShort(r.deliveryDate)}
              </span>
            )}

            {r.destinationName && (
              <span className="rounded-lg bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-800 border border-sky-200">
                届先: {r.destinationName}
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

          <ConfidenceBar value={r.ocrConfidence} />

          {r.status === 'ai_failed' && r.errorMessage && (
            <p className="rounded-lg bg-alert-bg/60 p-2.5 text-xs font-medium text-alert">
              失敗理由: {r.errorMessage}
            </p>
          )}
          {r.status === 'pending_ai' && (
            <p className="text-xs text-ink-muted">
              AIが文字を読み取り中または待機中です。「今すぐ読み取る」で即座に解析できます。
            </p>
          )}

          {/* AIアラート（数量変更・注意） */}
          {r.alerts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {r.alerts.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800"
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
              <span>解析された注文明細の内訳</span>
            </h3>
            {r.hasR2Key && (
              <a
                href={`/api/receipts/${r.id}/original`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-xs font-bold text-trust-600 hover:text-trust-700"
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                原本を別タブで全画面表示 ↗
              </a>
            )}
          </div>

          {r.items.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-xs">
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
                          <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-800">
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
              まだ明細が解析されていないか、注文情報が抽出されていません。
            </p>
          )}

          {/* 原本FAXのインラインプレビュー */}
          {r.hasR2Key && (
            <div className="rounded-lg border border-line bg-white p-2">
              <p className="text-[11px] font-bold text-ink-soft mb-1">原本プレビュー（縮小表示）:</p>
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg-card px-3 py-1.5 text-xs font-bold text-ink hover:bg-bg-soft active:scale-95 transition"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                <span>閉じる ▲</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                <span>詳細を見る ▼</span>
              </>
            )}
          </button>

          {r.hasR2Key && (
            <a
              href={`/api/receipts/${r.id}/original`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-bg-soft"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              原本を見る
            </a>
          )}
          {r.orderId && (
            <Link
              href={`/admin/orders/${r.orderId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-2.5 py-1.5 text-xs font-medium text-trust-700 hover:bg-trust-50"
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
