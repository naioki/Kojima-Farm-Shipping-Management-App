'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Trash2, Lightbulb, Columns, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { Button } from '@/components/ui/Button'
import { ApproveOrderButton } from '@/components/admin/ApproveOrderButton'
import { ReceiptOriginalTrigger } from '@/components/admin/ReceiptOriginalViewer'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'
import { formatJpDateShort } from '@/lib/dates'

export interface PackConfigOption {
  id: string
  label: string
}

export interface EditableOrderItem {
  id: string
  productName: string
  unit: string
  quantity: number
  confidence: number | null
  version: number
  /** 荷姿マスタ確定済みID（未確定は null） */
  packConfigId?: string | null
  /** 選べる荷姿（0件＝マスタ未登録なので選択UIを出さない） */
  packConfigOptions?: PackConfigOption[]
}

export interface DestinationOption {
  id: string
  label: string
}

export interface EditableOrderCardProps {
  orderId: string
  customerName: string
  customerColor?: string | null
  deliveryDate: string | null
  needsDeliveryDate: boolean
  /** 納入先が未確定（取引先に納入先があるのに未選択）。承認時に選択させる。 */
  needsDestination?: boolean
  destinationOptions?: DestinationOption[]
  /** 要確認の理由（あれば注意喚起バナーを出す） */
  reasons?: string[]
  items: EditableOrderItem[]
  /** 受信原本（FAX画像/PDF・メール本文）。手動入力・ポータル注文は null。 */
  receipt?: ReceiptOriginalInfo | null
  /** 承認ボタンのラベル（現場はやさしい日本語＋大きめ） */
  approveLabel?: string
  size?: 'sm' | 'md' | 'lg'
  /** 初期状態で詳細編集フォームを展開するか（デフォルト: 要確認があれば展開、なければサマリー表示） */
  defaultOpen?: boolean
}

interface Row extends EditableOrderItem {
  draft: string
  saving: boolean
  confirmDelete: boolean
}

/**
 * 承認前に内容を直せる注文カード（admin・現場 共通）。
 * 数量はその場で編集（楽観ロック version）。誤った明細は削除。要確認は注意喚起バナー＋赤表示。
 * 管理者が修正した際には「💡 この修正を取引先ルールとして学習させる」ワンクリック保存を提供する。
 */
export function EditableOrderCard({
  orderId,
  customerName,
  customerColor,
  deliveryDate,
  needsDeliveryDate,
  needsDestination = false,
  destinationOptions = [],
  reasons = [],
  items,
  receipt = null,
  approveLabel = '承認する',
  size = 'sm',
  defaultOpen,
}: EditableOrderCardProps) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((it) => ({ ...it, draft: String(it.quantity), saving: false, confirmDelete: false })),
  )
  const [suggestedRule, setSuggestedRule] = useState<string | null>(null)
  const [savingRule, setSavingRule] = useState(false)

  const caution = reasons.length > 0
  const [isOpen, setIsOpen] = useState(() => defaultOpen ?? caution)

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))

  async function saveLearnedRule() {
    if (!suggestedRule) return
    setSavingRule(true)
    try {
      const client = customerName.includes('未紐付け') ? '共通' : customerName
      const res = await fetch('/api/ai-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: client,
          rule_text: suggestedRule,
          priority: 5,
          category: 'parsing',
          is_active: true,
          source: 'hitl_approval',
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `保存失敗 (${res.status})`)
      toast.success('取引先ルールとしてAIに学習させました')
      setSuggestedRule(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ルールの学習保存に失敗しました')
    } finally {
      setSavingRule(false)
    }
  }

  async function savePackConfig(row: Row, packConfigId: string) {
    patch(row.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack_config_id: packConfigId || null, version: row.version }),
      })
      const json = (await res.json().catch(() => ({}))) as { item?: { version: number }; error?: string }
      if (res.status === 409) {
        toast.error('他の人が編集しました。画面を更新します')
        router.refresh()
        return
      }
      if (!res.ok) throw new Error(json.error ?? `保存に失敗 (${res.status})`)
      patch(row.id, { packConfigId: packConfigId || null, version: json.item?.version ?? row.version + 1, saving: false })
      toast.success('荷姿を確定しました')
      const chosen = row.packConfigOptions?.find((pc) => pc.id === packConfigId)?.label
      if (chosen) {
        setSuggestedRule(`【${customerName}】${row.productName}の荷姿・規格は「${chosen}」を標準として適用する。`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
      patch(row.id, { saving: false })
    }
  }

  async function saveQty(row: Row) {
    const n = Number(row.draft)
    if (row.draft.trim() === '' || !Number.isFinite(n) || n < 0) {
      toast.error('数量は0以上の数字で入れてください')
      patch(row.id, { draft: String(row.quantity) })
      return
    }
    if (n === row.quantity) return // 変更なし
    const oldQty = row.quantity
    patch(row.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: n, version: row.version }),
      })
      const json = (await res.json().catch(() => ({}))) as { item?: { quantity: number; version: number }; error?: string }
      if (res.status === 409) {
        toast.error('他の人が編集しました。画面を更新します')
        router.refresh()
        return
      }
      if (!res.ok) throw new Error(json.error ?? `保存に失敗 (${res.status})`)
      const q = json.item ? Number(json.item.quantity) : n
      patch(row.id, { quantity: q, draft: String(q), version: json.item?.version ?? row.version + 1, saving: false })
      toast.success('数量を直しました')
      setSuggestedRule(
        `【${customerName}】${row.productName}の数量読取で「${oldQty}」と誤読された場合は総パック数「${q}P」として解釈する。`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
      patch(row.id, { saving: false, draft: String(row.quantity) })
    }
  }

  async function deleteRow(row: Row) {
    patch(row.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除に失敗 (${res.status})`)
      }
      setRows((rs) => rs.filter((r) => r.id !== row.id))
      toast.success('明細を消しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
      patch(row.id, { saving: false, confirmDelete: false })
    }
  }

  return (
    <Card className={caution ? 'space-y-3 border-warning/50' : 'space-y-3'}>
      {/* サマリーバー（常時表示） */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ColorDot color={customerColor} name={customerName} size="md" />
          <span className="font-semibold text-ink">{customerName}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${
            deliveryDate ? 'bg-trust-50 text-trust-700' : 'bg-warning-bg text-warning'
          }`}>
            {deliveryDate ? `納品: ${formatJpDateShort(deliveryDate)}` : '納品日未定'}
          </span>
          {/* 品目サマリー（バッジ表示） */}
          <div className="flex flex-wrap items-center gap-1.5">
            {rows.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 rounded border border-line bg-bg-soft/60 px-2 py-0.5 text-xs text-ink"
              >
                <span>{r.productName}</span>
                <span className="font-bold tabular-nums text-trust-800">{r.quantity}</span>
                <span className="text-[10px] text-ink-muted">{r.unit}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/approvals"
            className="hidden items-center gap-1 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-trust-700 hover:bg-trust-50 sm:inline-flex"
          >
            <Columns className="h-3.5 w-3.5" aria-hidden />
            スプリット比較
          </Link>

          {/* 開閉トグルボタン */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="inline-flex items-center gap-1 rounded border border-line bg-bg-card px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-bg-soft hover:text-ink"
            aria-expanded={isOpen}
          >
            <span>{isOpen ? '閉じる' : `詳細・編集 (${rows.length}品目)`}</span>
            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {/* 即時承認ボタン（閉じた状態でも承認可能） */}
          <ApproveOrderButton
            orderId={orderId}
            needsDeliveryDate={needsDeliveryDate}
            needsDestination={needsDestination}
            destinationOptions={destinationOptions}
            label={approveLabel}
            size={size}
          />
        </div>
      </div>

      {/* 要確認バッジ（サマリー下に表示） */}
      {caution && (
        <div className="flex flex-wrap gap-1 pt-1">
          {reasons.map((r) => (
            <span key={r} className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
              ⚠️ {r}
            </span>
          ))}
        </div>
      )}

      {/* 詳細展開エリア（アコーディオン） */}
      {isOpen && (
        <div className="space-y-3 border-t border-line/60 pt-3">
          {receipt && <ReceiptOriginalTrigger receipt={receipt} />}

          {suggestedRule && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-earth-300 bg-earth-50 px-3 py-2 text-xs text-ink">
              <span className="flex items-center gap-1.5 font-medium text-earth-800">
                <Lightbulb className="h-4 w-4 shrink-0 text-earth-600" aria-hidden />
                💡 この修正を取引先ルールとして学習させる
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="primary" size="sm" onClick={saveLearnedRule} isLoading={savingRule}>
                  ワンクリック保存
                </Button>
                <button
                  type="button"
                  onClick={() => setSuggestedRule(null)}
                  className="rounded px-2 py-1 text-xs text-ink-faint hover:bg-bg-soft"
                >
                  閉じる
                </button>
              </div>
            </div>
          )}

          {caution && (
            <p className="flex items-start gap-1.5 rounded-lg bg-warning-bg px-3 py-2 text-sm font-medium text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              まちがいが あるかも しれません。数字を よく かくにん・しゅうせい してから しょうにん してください。
            </p>
          )}

          <ul className="divide-y divide-line rounded border border-line">
            {rows.map((row) => {
              const low = row.confidence == null || row.confidence < 0.7
              const needsPack = (row.packConfigOptions?.length ?? 0) > 0 && !row.packConfigId
              return (
                <li key={row.id} className="space-y-1.5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-base text-ink">{row.productName}</span>
                    {low && (
                      <span className="num shrink-0 text-xs font-medium text-alert">
                        {row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '?'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {row.saving && (
                      <span className="text-[11px] font-bold text-trust-600 animate-pulse">
                        保存中...
                      </span>
                    )}
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={row.draft}
                      disabled={row.saving}
                      onChange={(e) => patch(row.id, { draft: e.target.value })}
                      onBlur={() => saveQty(row)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      aria-label={`${row.productName} の数量`}
                      className={`num h-11 w-20 rounded border bg-bg-card px-2 text-right text-base tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-trust-100 ${
                        low ? 'border-alert/50 focus:border-alert' : 'border-line-strong focus:border-trust-500'
                      }`}
                    />
                    <span className="w-8 shrink-0 text-sm text-ink-soft">{row.unit}</span>
                    {row.confirmDelete ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={row.saving}
                          onClick={() => deleteRow(row)}
                          className="rounded bg-alert px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                        >
                          けす
                        </button>
                        <button
                          type="button"
                          disabled={row.saving}
                          onClick={() => patch(row.id, { confirmDelete: false })}
                          className="rounded px-2 py-1.5 text-xs text-ink-soft hover:bg-bg-soft disabled:opacity-50"
                        >
                          やめる
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patch(row.id, { confirmDelete: true })}
                        disabled={row.saving}
                        aria-label={`${row.productName} を削除`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-alert/5 hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/20 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  {(row.packConfigOptions?.length ?? 0) > 0 && (
                    <label className="flex items-center gap-2">
                      <span className={`shrink-0 text-xs font-medium ${needsPack ? 'text-alert' : 'text-ink-soft'}`}>
                        荷姿{needsPack ? '（みてい）' : ''}
                      </span>
                      <select
                        value={row.packConfigId ?? ''}
                        disabled={row.saving}
                        onChange={(e) => savePackConfig(row, e.target.value)}
                        aria-label={`${row.productName} の荷姿`}
                        className={`h-9 flex-1 rounded border bg-bg-card px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-trust-100 ${
                          needsPack ? 'border-alert/50 focus:border-alert' : 'border-line-strong focus:border-trust-500'
                        }`}
                      >
                        <option value="">選択してください</option>
                        {row.packConfigOptions!.map((pc) => (
                          <option key={pc.id} value={pc.id}>
                            {pc.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              )
            })}
          </ul>

          {rows.length === 0 && (
            <p className="text-sm text-ink-soft">明細がありません。受注一覧から この注文を削除できます。</p>
          )}
        </div>
      )}
    </Card>
  )
}
