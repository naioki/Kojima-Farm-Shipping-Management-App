import { FileText, Mail, Globe, PenLine, AlertTriangle, Link2Off, Clock, CheckCircle2 } from 'lucide-react'

/**
 * 受注ボックスのバッジ群（design.md / WCAG: 色だけに頼らずアイコン＋テキストを併用）。
 *  - ChannelBadge: 受信チャネル（FAX/メール/ポータル/手動）
 *  - ReceiptStatusBadge: 受信レコードの状態（解析待ち/解析失敗/未紐付け）
 *  - OrderStatusBadge: 注文の状態（承認待ち/承認済み）
 */

type IconType = typeof FileText

const CHANNEL: Record<string, { label: string; icon: IconType }> = {
  fax: { label: 'FAX', icon: FileText },
  email: { label: 'メール', icon: Mail },
  portal: { label: 'ポータル', icon: Globe },
  manual: { label: '手動', icon: PenLine },
}

export function ChannelBadge({ channel }: { channel: string }) {
  const c = CHANNEL[channel] ?? { label: channel, icon: FileText }
  const Icon = c.icon
  return (
    <span className="inline-flex items-center gap-1 rounded bg-earth-100 px-2 py-0.5 text-xs font-medium text-earth-800">
      <Icon className="h-3 w-3" aria-hidden />
      {c.label}
    </span>
  )
}

export function ReceiptStatusBadge({ status }: { status: string }) {
  if (status === 'pending_ai') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-trust-100 px-2 py-0.5 text-xs font-medium text-trust-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-trust-500" aria-hidden />
        解析待ち
      </span>
    )
  }
  if (status === 'ai_failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        解析失敗
      </span>
    )
  }
  if (status === 'unmatched') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">
        <Link2Off className="h-3 w-3" aria-hidden />
        未紐付け
      </span>
    )
  }
  return null
}

export function OrderStatusBadge({ kind }: { kind: 'pending' | 'approved' }) {
  if (kind === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-harvest-100 px-2 py-0.5 text-xs font-medium text-harvest-700">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        承認済み
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
      <Clock className="h-3 w-3" aria-hidden />
      承認待ち
    </span>
  )
}
