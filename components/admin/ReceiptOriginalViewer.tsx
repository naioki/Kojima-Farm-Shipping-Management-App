'use client'

import { useState } from 'react'
import { ExternalLink, FileImage, MailOpen } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/Modal'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'

const CHANNEL_LABEL: Record<string, string> = { fax: 'FAX', email: 'メール', portal: 'ポータル', manual: '手動' }

function OriginalPane({
  receiptId,
  hasOriginal,
  previewUrl,
  originalUrl,
  emailText,
  label,
}: {
  receiptId: string
  hasOriginal: boolean
  previewUrl?: string | null
  originalUrl?: string | null
  emailText: string | null
  label: string
}) {
  const iframeSrc = previewUrl || `/api/receipts/${receiptId}/original`
  const openUrl = originalUrl || `/api/receipts/${receiptId}/original`
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-soft">{label}</p>
        {hasOriginal && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-trust-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            Googleドライブで開く
          </a>
        )}
      </div>
      {hasOriginal ? (
        <iframe
          src={iframeSrc}
          title={label}
          className="h-[65vh] w-full rounded border border-line bg-bg-soft"
        />
      ) : emailText ? (
        <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded border border-line bg-bg-soft p-3 font-mono text-xs text-ink">
          {emailText}
        </pre>
      ) : (
        <p className="rounded border border-line bg-bg-soft px-3 py-6 text-center text-sm text-ink-faint">原本がありません</p>
      )}
    </div>
  )
}

/**
 * 承認画面で「AIが読んだ数量」と「原本（Kojima-FAX が Google Drive に保存した PDF・メール本文）」を見比べるためのトリガー＋オーバーレイ。
 */
export function ReceiptOriginalTrigger({ receipt }: { receipt: ReceiptOriginalInfo }) {
  const [open, setOpen] = useState(false)

  if (!receipt.hasOriginal && !receipt.emailText) return null

  const emphasize = receipt.channel === 'fax' || receipt.channel === 'email'
  const directUrl = receipt.originalUrl || `/api/receipts/${receipt.id}/original`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'hidden items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-bg-soft md:inline-flex',
          emphasize ? 'border-trust-300 bg-trust-50 text-trust-700' : 'border-line-strong bg-bg-card text-ink',
        )}
      >
        {receipt.hasOriginal ? <FileImage className="h-3.5 w-3.5" aria-hidden /> : <MailOpen className="h-3.5 w-3.5" aria-hidden />}
        原本を見る（{CHANNEL_LABEL[receipt.channel] ?? receipt.channel}）
        {receipt.isRevision && <span className="text-ink-faint">・再送</span>}
      </button>

      {/* モバイルは別タブで Google Drive 原本を直接開く */}
      <a
        href={directUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-bg-soft md:hidden"
      >
        原本を見る（別タブ）
      </a>

      <Modal open={open} onClose={() => setOpen(false)} title="受信原本（Google Drive 連携）" className="max-w-3xl">
        <div className="space-y-4">
          {receipt.isRevision && receipt.parent && (
            <OriginalPane
              receiptId={receipt.parent.id}
              hasOriginal={receipt.parent.hasOriginal}
              previewUrl={receipt.parent.previewUrl}
              originalUrl={receipt.parent.originalUrl}
              emailText={receipt.parent.emailText}
              label="元の受信（再送前）"
            />
          )}
          <OriginalPane
            receiptId={receipt.id}
            hasOriginal={receipt.hasOriginal}
            previewUrl={receipt.previewUrl}
            originalUrl={receipt.originalUrl}
            emailText={receipt.emailText}
            label={receipt.isRevision ? '再送分（差分）' : '受信原本'}
          />
        </div>
      </Modal>
    </>
  )
}
