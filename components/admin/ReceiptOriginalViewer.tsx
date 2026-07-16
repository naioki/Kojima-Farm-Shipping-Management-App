'use client'

import { useState } from 'react'
import { FileImage, MailOpen } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/Modal'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'

const CHANNEL_LABEL: Record<string, string> = { fax: 'FAX', email: 'メール', portal: 'ポータル', manual: '手動' }

function OriginalPane({
  receiptId,
  hasOriginal,
  emailText,
  label,
}: {
  receiptId: string
  hasOriginal: boolean
  emailText: string | null
  label: string
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      {hasOriginal ? (
        <iframe
          src={`/api/receipts/${receiptId}/original`}
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
 * 承認画面で「AIが読んだ数量」と「原本（FAX/PDF・メール本文）」を見比べるためのトリガー＋オーバーレイ。
 * PC: ボタンでオーバーレイ表示（開いた時だけ iframe を mount、閉じたら破棄＝重複ロード回避）。
 * モバイル: 承認は基本PCで行う想定のため、オーバーレイの代わりに別タブで開くリンクにフォールバック。
 * 再送（差分）受信は、元の受信も並べて表示する。
 */
export function ReceiptOriginalTrigger({ receipt }: { receipt: ReceiptOriginalInfo }) {
  const [open, setOpen] = useState(false)

  if (!receipt.hasOriginal && !receipt.emailText) return null

  const emphasize = receipt.channel === 'fax' || receipt.channel === 'email'

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

      {/* モバイルは左右比較の手間より単純さを優先し、別タブで開く既存動線にフォールバック */}
      <a
        href={`/api/receipts/${receipt.id}/original`}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-bg-soft md:hidden"
      >
        原本を見る（別タブ）
      </a>

      <Modal open={open} onClose={() => setOpen(false)} title="受信原本" className="max-w-3xl">
        <div className="space-y-4">
          {receipt.isRevision && receipt.parent && (
            <OriginalPane
              receiptId={receipt.parent.id}
              hasOriginal={receipt.parent.hasOriginal}
              emailText={receipt.parent.emailText}
              label="元の受信（再送前）"
            />
          )}
          <OriginalPane
            receiptId={receipt.id}
            hasOriginal={receipt.hasOriginal}
            emailText={receipt.emailText}
            label={receipt.isRevision ? '再送分（差分）' : '受信原本'}
          />
        </div>
      </Modal>
    </>
  )
}
