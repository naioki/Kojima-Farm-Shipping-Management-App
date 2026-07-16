'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
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
}

interface Row extends EditableOrderItem {
  draft: string
  saving: boolean
  confirmDelete: boolean
}

/**
 * 承認前に内容を直せる注文カード（admin・現場 共通）。
 * 数量はその場で編集（楽観ロック version）。誤った明細は削除。要確認は注意喚起バナー＋赤表示。
 * 荷姿(pack_config)が選べる商品は、未確定ならその場で選ばせる（出荷一覧で箱数を計算するため必須）。
 * 確定（承認）は ApproveOrderButton（納品日・納入先が未確定ならその場で入力）。
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
}: EditableOrderCardProps) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((it) => ({ ...it, draft: String(it.quantity), saving: false, confirmDelete: false })),
  )
  const caution = reasons.length > 0

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))

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
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <ColorDot color={customerColor} name={customerName} size="md" className="mt-1" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{customerName}</p>
            <p className="text-xs text-ink-soft">のうひん {deliveryDate ? formatJpDateShort(deliveryDate) : 'みてい'}</p>
          </div>
        </div>
        {caution && (
          <div className="flex flex-wrap gap-1">
            {reasons.map((r) => (
              <span key={r} className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
                {r}
              </span>
            ))}
          </div>
        )}
        {receipt && <ReceiptOriginalTrigger receipt={receipt} />}
      </div>

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
                    onClick={() => deleteRow(row)}
                    className="rounded bg-alert px-2 py-1.5 text-xs font-bold text-white"
                  >
                    けす
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(row.id, { confirmDelete: false })}
                    className="rounded px-2 py-1.5 text-xs text-ink-soft hover:bg-bg-soft"
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

      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">明細がありません。受注一覧から この注文を削除できます。</p>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <ApproveOrderButton
            orderId={orderId}
            needsDeliveryDate={needsDeliveryDate}
            needsDestination={needsDestination}
            destinationOptions={destinationOptions}
            label={approveLabel}
            size={size}
          />
        </div>
      )}
    </Card>
  )
}
