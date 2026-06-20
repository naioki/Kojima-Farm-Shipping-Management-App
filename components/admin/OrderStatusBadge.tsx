/** 受注ステータス・受注元のラベル表示（一覧・詳細で共有）。色だけに頼らずラベル併用（WCAG）。 */

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_review: { label: '承認待ち', cls: 'bg-earth-100 text-earth-700' },
  approved: { label: '承認済み', cls: 'bg-harvest-100 text-harvest-700' },
  shipped: { label: '出荷済み', cls: 'bg-trust-100 text-trust-700' },
  invoiced: { label: '請求済み', cls: 'bg-bg-soft text-ink-soft' },
  cancelled: { label: '取消', cls: 'bg-alert-bg text-alert' },
}

const SOURCE: Record<string, string> = { fax: 'FAX', email: 'メール', portal: 'ポータル', manual: '手動' }

export function OrderStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-warning-bg text-warning' }
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  )
}

export function sourceLabel(source: string): string {
  return SOURCE[source] ?? source
}

/** ステータスの日本語ラベル（CSV など非UI用途で共有）。 */
export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status
}

/** 絞り込みUI用：選択肢（value/label）。 */
export const ORDER_STATUS_OPTIONS = Object.entries(STATUS).map(([value, v]) => ({ value, label: v.label }))
