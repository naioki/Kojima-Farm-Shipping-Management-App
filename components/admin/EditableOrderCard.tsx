'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { Button } from '@/components/ui/Button'
import { ApproveOrderButton } from '@/components/admin/ApproveOrderButton'
import { RejectOrderButton } from '@/components/admin/RejectOrderButton'
import { ReceiptOriginalTrigger } from '@/components/admin/ReceiptOriginalViewer'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'
import { formatJpDateShort } from '@/lib/dates'
import { extractActionableNote } from '@/lib/field/clean-note'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { quantityAnomalyFor } from '@/lib/orders/pending-types'
import { showResponseWarnings } from '@/lib/client/show-warnings'

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
  spec?: string | null
  containerType?: string | null
  lineNote?: string | null
  /** いつもの数量（同じ取引先×品目の中央値）。あれば「いつもと違う数量」を判定して表示する */
  usualQuantity?: number | null
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
  destinationName?: string | null
  /** FAX・メモに書かれていた納入先の文字（マスタと照合できなかったときの参考表示） */
  destinationHint?: string | null
  notes?: string | null
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
function resolveCardPacksPerCase(customerName: string, spec?: string | null, containerType?: string | null): number {
  const combined = `${customerName} ${spec ?? ''} ${containerType ?? ''}`.normalize('NFKC')
  const m = combined.match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
  if (m) {
    const n = Number(m[1] || m[2])
    if (Number.isFinite(n) && n > 0 && n <= 200) return n
  }
  if (combined.includes('小コン')) return 30
  if (combined.includes('農業総合研究所') || combined.toUpperCase().includes('NSK')) return 24
  return 20
}

export function EditableOrderCard({
  orderId,
  customerName,
  customerColor,
  deliveryDate,
  destinationName,
  destinationHint = null,
  notes,
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
      const client = customerName.includes('未登録') || customerName.includes('未紐付け') ? '共通' : customerName
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
    const ppc = resolveCardPacksPerCase(customerName, row.spec, row.containerType)
    const parsedQty = parseQuantity(row.draft, { packsPerCase: ppc })
    const n = parsedQty.type === 'ok' ? parsedQty.total.toNumber() : Number(row.draft)
    if (row.draft.trim() === '' || !Number.isFinite(n) || n < 0) {
      toast.error('数量は0以上の数字または「30c（箱数）」で入れてください')
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
      showResponseWarnings(await res.json().catch(() => null))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
      patch(row.id, { saving: false, confirmDelete: false })
    }
  }

  // 承認ボタンへ渡す: 荷姿の選び忘れ（押す前に止める）と、いつもと違う数量（押したときに確認）
  const missingPack = rows
    .filter((r) => (r.packConfigOptions?.length ?? 0) > 0 && !r.packConfigId)
    .map((r) => r.productName)
  const anomalies = rows.flatMap((r) => {
    const kind = quantityAnomalyFor(r.quantity, r.usualQuantity)
    return kind && r.usualQuantity != null
      ? [{ productName: r.productName, quantity: r.quantity, unit: r.unit, usualQuantity: r.usualQuantity, kind }]
      : []
  })
  const note = extractActionableNote(notes)

  return (
    <Card className={caution ? 'space-y-3 border-warning/50' : 'space-y-3'}>
      {/* 見出し: 取引先 ＞ 納入先・納品日 */}
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <ColorDot color={customerColor} name={customerName} size="md" className="mt-1" />
          <p className="min-w-0 break-words text-base font-bold text-ink">
            {customerName}
            <span className={destinationName ? 'font-normal text-ink-soft' : needsDestination ? 'font-bold text-alert' : 'font-normal text-ink-faint'}>
              {' '}＞ {destinationName ?? (needsDestination ? 'のうにゅうさき みてい' : '納入先なし')}
            </span>
          </p>
        </div>
        {!destinationName && destinationHint && (
          <p className="text-xs text-ink-soft">FAXの記載: {destinationHint}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-lg border px-2.5 py-0.5 text-xs font-bold ${
              deliveryDate ? 'border-trust-100 bg-trust-50 text-trust-700' : 'border-warning/40 bg-warning-bg text-warning'
            }`}
          >
            {deliveryDate ? `のうひん ${formatJpDateShort(deliveryDate)}` : 'のうひん日 みてい'}
          </span>
          {/* 品目サマリー（箱数＋パック数） */}
          {rows.map((r) => {
            const ppc = resolveCardPacksPerCase(customerName, r.spec, r.containerType)
            const boxes = r.quantity > 0 ? Math.ceil(r.quantity / ppc) : 0
            return (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 rounded-md border border-forest-200 bg-forest-50/80 px-2.5 py-0.5 text-xs text-ink"
              >
                <span className="font-bold">{r.productName}</span>
                <span className="font-black tabular-nums text-forest-800">{boxes}箱</span>
                <span className="font-bold tabular-nums text-ink-soft">
                  ({r.quantity.toLocaleString()}
                  {r.unit})
                </span>
              </span>
            )
          })}
        </div>
      </div>

      {/* 注文備考（システムタグを除いた伝達事項のみ） */}
      {note && (
        <div className="rounded-lg border border-warning/80 bg-warning-bg/70 px-3 py-1.5 text-xs text-ink">
          <span className="font-bold">FAX・メモ: </span>
          <span>{note}</span>
        </div>
      )}

      {/* 確認が必要な理由 */}
      {caution && (
        <div className="flex flex-wrap gap-1">
          {reasons.map((r) => (
            <span key={r} className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
              ⚠️ {r}
            </span>
          ))}
        </div>
      )}

      {/* いつもと違う数量（閉じていても見えるように） */}
      {anomalies.length > 0 && (
        <ul className="space-y-1">
          {anomalies.map((a) => (
            <li
              key={a.productName}
              className="flex items-start gap-1.5 rounded-md bg-alert-bg px-2.5 py-1.5 text-sm font-bold text-alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {a.productName} {Math.round(a.quantity).toLocaleString()}
                {a.unit}（いつもは {Math.round(a.usualQuantity).toLocaleString()}
                {a.unit} ぐらい）
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {receipt && <ReceiptOriginalTrigger receipt={receipt} />}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-line bg-bg-card px-3 text-sm font-medium text-ink-soft hover:bg-bg-soft hover:text-ink"
          aria-expanded={isOpen}
        >
          <span>{isOpen ? 'とじる' : `なかみを見る・なおす（${rows.length}品目）`}</span>
          {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
      </div>

      {/* 明細（なおす） */}
      {isOpen && (
        <div className="space-y-3 border-t border-line/60 pt-3">
          {suggestedRule && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-earth-300 bg-earth-50 px-3 py-2 text-xs text-ink">
              <span className="flex items-center gap-1.5 font-medium text-earth-800">
                <Lightbulb className="h-4 w-4 shrink-0 text-earth-600" aria-hidden />
                この直し方を AI に覚えさせる
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="primary" size="sm" className="h-10" onClick={saveLearnedRule} isLoading={savingRule}>
                  覚えさせる
                </Button>
                <button
                  type="button"
                  onClick={() => setSuggestedRule(null)}
                  className="min-h-10 rounded px-3 text-xs text-ink-soft hover:bg-bg-soft"
                >
                  とじる
                </button>
              </div>
            </div>
          )}

          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {rows.map((row) => {
              const low = row.confidence == null || row.confidence < 0.7
              const needsPack = (row.packConfigOptions?.length ?? 0) > 0 && !row.packConfigId
              const draftNum = Number(row.draft)
              const anomaly = quantityAnomalyFor(
                Number.isFinite(draftNum) && row.draft.trim() !== '' ? draftNum : row.quantity,
                row.usualQuantity,
              )
              const itemDetails = [row.spec, row.containerType, extractActionableNote(row.lineNote)].filter(Boolean).join(' ・ ')
              return (
                <li key={row.id} className="space-y-2 px-3.5 py-3 transition-colors hover:bg-bg-soft/30">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-ink">{row.productName}</span>
                      {itemDetails && (
                        <span className="rounded-md border border-line bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
                          {itemDetails}
                        </span>
                      )}
                    </div>
                    {low && (
                      <span className="num shrink-0 whitespace-nowrap rounded bg-alert-bg px-2 py-0.5 text-xs font-bold text-alert">
                        AI じしんなし{row.confidence != null ? `（${Math.round(row.confidence * 100)}%）` : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {row.saving && <span className="animate-pulse text-xs font-bold text-trust-600">ほぞん中...</span>}
                    <input
                      type="text"
                      inputMode="text"
                      placeholder="例:30c"
                      value={row.draft}
                      disabled={row.saving}
                      onChange={(e) => patch(row.id, { draft: e.target.value })}
                      onBlur={() => saveQty(row)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      aria-label={`${row.productName} の数量`}
                      className={`num h-11 w-24 rounded-lg border bg-bg-card px-2.5 text-right text-base font-bold tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-trust-100 ${
                        low || anomaly ? 'border-alert/60 focus:border-alert' : 'border-line-strong focus:border-trust-500'
                      }`}
                    />
                    <span className="shrink-0 text-xs font-bold text-ink-soft">
                      {row.unit}（約
                      {Math.ceil((Number(row.draft) || 0) / resolveCardPacksPerCase(customerName, row.spec, row.containerType))}
                      箱）
                    </span>
                    {row.confirmDelete ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={row.saving}
                          onClick={() => deleteRow(row)}
                          className="min-h-10 rounded-lg bg-alert px-3 text-xs font-bold text-white disabled:opacity-50"
                        >
                          けす
                        </button>
                        <button
                          type="button"
                          disabled={row.saving}
                          onClick={() => patch(row.id, { confirmDelete: false })}
                          className="min-h-10 rounded-lg border border-line px-3 text-xs text-ink-soft hover:bg-bg-soft disabled:opacity-50"
                        >
                          やめる
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patch(row.id, { confirmDelete: true })}
                        disabled={row.saving}
                        aria-label={`${row.productName} を けす`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-alert/5 hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/20 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  {anomaly && row.usualQuantity != null && (
                    <p className="text-right text-xs font-bold text-alert">
                      いつもは {Math.round(row.usualQuantity).toLocaleString()}
                      {row.unit} ぐらいです。FAX を たしかめてください。
                    </p>
                  )}
                  {(row.packConfigOptions?.length ?? 0) > 0 && (
                    <label className="flex items-center gap-2">
                      <span className={`shrink-0 text-xs font-bold ${needsPack ? 'text-alert' : 'text-ink-soft'}`}>
                        にすがた{needsPack ? '（えらんでください）' : ''}
                      </span>
                      <select
                        value={row.packConfigId ?? ''}
                        disabled={row.saving}
                        onChange={(e) => savePackConfig(row, e.target.value)}
                        className={`h-10 min-w-0 flex-1 rounded-lg border bg-bg-card px-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-trust-100 ${
                          needsPack ? 'border-alert/50 focus:border-alert' : 'border-line-strong focus:border-trust-500'
                        }`}
                      >
                        <option value="">えらんでください</option>
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
            <p className="text-sm text-ink-soft">明細がありません。管理者に この注文の削除を たのんでください。</p>
          )}
        </div>
      )}

      {/* 承認・却下（理由と明細のあと） */}
      <div className="flex flex-wrap items-start justify-end gap-2 border-t border-line/60 pt-3">
        <RejectOrderButton orderId={orderId} customerName={customerName} deliveryDate={deliveryDate} size={size} />
        {/* 編集中は連打・競合防止でロック */}
        <div className={rows.some((r) => r.saving) ? 'pointer-events-none opacity-50' : ''}>
          <ApproveOrderButton
            orderId={orderId}
            needsDeliveryDate={needsDeliveryDate}
            needsDestination={needsDestination}
            destinationOptions={destinationOptions}
            destinationHint={destinationHint}
            missingPackProducts={missingPack}
            anomalies={anomalies}
            label={approveLabel}
            size={size}
            kana
          />
        </div>
      </div>
    </Card>
  )
}
