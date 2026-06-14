'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Circle, Check, Truck, IdCard, PauseCircle, StickyNote, AlertTriangle, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import type { FieldStatus, SpecWarning } from '@/types/database'
import { ColorDot } from '@/components/ui/ColorDot'
import { nextFieldStatus, canAdvance, FIELD_STATUS_META } from '@/lib/field/tap-loop'
import { ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

const ICONS = { circle: Circle, check: Check, truck: Truck } as const

// Tailwind JIT は動的クラス名を拾えないため status→色は literal で持つ（MatrixCell と同方針）。
const STATUS_TEXT: Record<FieldStatus, string> = {
  not_started: 'text-line-strong',
  packed: 'text-trust-500',
  shipped: 'text-harvest-500',
}

export interface ShipmentRowProps {
  itemId: string
  customerName: string
  /** 取引先の識別色（hex or null → 名前から自動生成） */
  customerColor?: string | null
  /** 総数表示（"120" や "6c0" など、呼び出し側で整形） */
  quantityText: string
  /** 受注総数（中断時の「できた数」との比較・部分完了判定に使う） */
  orderedQty: number
  initialStatus: FieldStatus
  initialVersion: number
  /** 荷姿まわり（規則から自動補完済みの初期値） */
  initialSpec: string | null
  initialContainer: string | null
  initialHasCard: boolean | null
  initialLineNote: string | null
  /** 現場の記録（中断時の部分完了数・現場メモ） */
  initialShippedQty: number | null
  initialFieldNote: string | null
  /** 梱包時注意事項（禁止事項・必須事項）。常時表示 */
  specWarnings?: SpecWarning[] | null
  /** 出荷済みに前進した瞬間に呼ばれる（親が一定時間後に末尾へ並べ替えるため） */
  onShipped?: (itemId: string) => void
}

/**
 * 出荷一覧の1行（Laravel版 画面2の ◀▶ ＋ 荷姿アコーディオン）。
 * ▶=前進、◀=確認付きで1段戻す（安全版タップループ・features.md §7）。
 * 「詳細」を開くと 規格・荷姿・カード有無・追記事項 を確認/上書きできる（規則から自動補完済み）。
 * 金額は一切表示しない（現場が品目と数量に集中するため）。
 */
export function ShipmentRow({
  itemId,
  customerName,
  customerColor,
  quantityText,
  orderedQty,
  initialStatus,
  initialVersion,
  initialSpec,
  initialContainer,
  initialHasCard,
  initialLineNote,
  initialShippedQty,
  initialFieldNote,
  specWarnings,
  onShipped,
}: ShipmentRowProps) {
  const [status, setStatus] = useState<FieldStatus>(initialStatus)
  const [version, setVersion] = useState(initialVersion)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // アコーディオン（荷姿）
  const [open, setOpen] = useState(false)
  const [spec, setSpec] = useState(initialSpec ?? '')
  const [container, setContainer] = useState(initialContainer ?? '')
  const [hasCard, setHasCard] = useState(Boolean(initialHasCard))
  const [lineNote, setLineNote] = useState(initialLineNote ?? '')
  // 現場の記録（中断時の部分完了数・現場メモ）
  const [shippedQty, setShippedQty] = useState(initialShippedQty == null ? '' : String(initialShippedQty))
  const [fieldNote, setFieldNote] = useState(initialFieldNote ?? '')
  const [savingDetails, setSavingDetails] = useState(false)
  // 行から開かずに「できた数」を素早く記録するクイック入力
  const [quickOpen, setQuickOpen] = useState(false)
  const [savingQuick, setSavingQuick] = useState(false)

  const meta = FIELD_STATUS_META[status]
  const Icon = ICONS[meta.icon]
  const hasDetails = spec || container || hasCard || lineNote
  // 「途中で止まった」= できた数が受注総数に満たない。出荷前でも記録できる。
  const shippedNum = shippedQty.trim() === '' ? null : Number(shippedQty)
  const isPartial = shippedNum != null && Number.isFinite(shippedNum) && shippedNum < orderedQty
  // 中断＝できた数が受注未満で、まだ出荷していない。梱包完了（全量）と明確に区別する。
  const interrupted = isPartial && status !== 'shipped'

  async function advance() {
    if (!canAdvance(status) || busy) return
    const target = nextFieldStatus(status)
    const prev = status
    setStatus(target)
    setBusy(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field_status: target, version }),
      })
      if (res.status === 409) {
        setStatus(prev)
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`更新失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      setConflict(false)
      // 出荷済みに到達したら、親に通知（一定時間後に末尾へ並べ替え）
      if (target === 'shipped') onShipped?.(itemId)
    } catch (e) {
      setStatus(prev)
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    const prev = status
    setBusy(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`戻す操作に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { field_status: FieldStatus; version: number } }
      setStatus(json.item.field_status)
      setVersion(json.item.version)
      setConflict(false)
    } catch (e) {
      setStatus(prev)
      toast.error(e instanceof Error ? e.message : '戻す操作に失敗しました')
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  async function saveDetails() {
    setSavingDetails(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spec: spec || null,
          container_type: container || null,
          has_card: hasCard,
          line_note: lineNote || null,
          shipped_qty: shippedNum != null && Number.isFinite(shippedNum) ? shippedNum : null,
          field_note: fieldNote || null,
          version,
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`保存に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      toast.success('記録を保存しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingDetails(false)
    }
  }

  /** クイック入力：できた数（shipped_qty）だけを即保存。荷姿・メモは触らない。 */
  async function saveQuick() {
    setSavingQuick(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shipped_qty: shippedNum != null && Number.isFinite(shippedNum) ? shippedNum : null,
          version,
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`保存に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      toast.success('できた数を記録しました')
      setQuickOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingQuick(false)
    }
  }

  const fieldInput =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className={cn('rounded border', conflict ? 'animate-pulse-alert border-alert' : 'border-line')}>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
        >
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} aria-hidden />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <ColorDot color={customerColor} name={customerName} />
              <span className="truncate text-sm font-medium text-ink">{customerName}</span>
            </span>
            <span className="num block text-base font-bold tabular-nums text-ink">{quantityText}</span>
          </span>
          {hasDetails && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-xs text-ink-soft">
              {hasCard && <IdCard className="h-3 w-3" aria-hidden />}
              {[container, spec].filter(Boolean).join(' / ') || '荷姿あり'}
            </span>
          )}
          {Boolean(fieldNote) && (
            // 現場メモがある行はメモアイコンで明示（中断は右のステータス欄で色分け表示）
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
              <StickyNote className="h-3 w-3" aria-hidden />
              メモ
            </span>
          )}
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || status === 'not_started'}
            aria-label="1段戻す"
            className="flex h-12 w-12 items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <span className="flex w-20 flex-col items-center gap-0.5">
            {interrupted ? (
              <>
                <PauseCircle className="h-5 w-5 text-warning" aria-hidden />
                <span className="text-xs font-medium text-warning">中断</span>
                <span className="num text-[10px] tabular-nums text-warning">{shippedNum}/{orderedQty}</span>
              </>
            ) : (
              <>
                <Icon className={cn('h-5 w-5', STATUS_TEXT[status])} aria-hidden />
                <span className="text-xs text-ink-soft">{meta.label}</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={advance}
            disabled={busy || !canAdvance(status)}
            aria-label="次のステータスへ進める"
            className="flex h-12 w-12 items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setQuickOpen((v) => !v)}
            aria-expanded={quickOpen}
            aria-label="中断・できた数を記録"
            title="中断・できた数を記録"
            className={cn(
              'flex h-12 w-10 items-center justify-center rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100',
              isPartial
                ? 'border-harvest-200 bg-harvest-50 text-earth-700'
                : 'border-line text-ink-soft hover:bg-bg-soft',
            )}
          >
            <PauseCircle className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* 規格警告（禁止事項・必須事項）— 常時1行表示。アコーディオンを開かずに確認できる */}
      {specWarnings && specWarnings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-warning-bg/30 px-3 py-1.5">
          {specWarnings.map((w, i) =>
            w.type === 'forbidden' ? (
              <span key={i} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-alert bg-alert/10">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {w.text}
              </span>
            ) : (
              <span key={i} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-harvest-700 bg-harvest-50">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                {w.text}
              </span>
            ),
          )}
        </div>
      )}

      {quickOpen && (
        // 行から開かずに「できた数」だけを素早く記録（中断時）。荷姿/メモは下のアコーディオン。
        <div className="flex items-center gap-2 border-t border-line bg-harvest-50/40 px-3 py-2">
          <span className="shrink-0 text-xs font-medium text-ink-soft">できた数</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            className={cn(fieldInput, 'num h-10 w-24 tabular-nums')}
            value={shippedQty}
            onChange={(e) => setShippedQty(e.target.value)}
            placeholder="例: 20"
          />
          <span className="shrink-0 text-xs text-ink-faint">／ 受注 {orderedQty}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {shippedQty !== '' && (
              <button
                type="button"
                onClick={() => setShippedQty('')}
                className="rounded px-2 py-1 text-xs text-ink-faint hover:bg-bg-soft"
              >
                クリア
              </button>
            )}
            <Button size="sm" onClick={saveQuick} isLoading={savingQuick}>
              保存
            </Button>
          </div>
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-line bg-bg-soft/40 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-soft">荷姿</span>
              <input className={fieldInput} value={container} onChange={(e) => setContainer(e.target.value)} placeholder="ケース/箱/化粧箱" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-soft">規格</span>
              <input className={fieldInput} value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="L/200g 等" />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hasCard} onChange={(e) => setHasCard(e.target.checked)} className="h-5 w-5 accent-earth-600" />
            <span className="text-sm text-ink">カード同梱</span>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs font-medium text-ink-soft">追記事項</span>
            <textarea
              className={cn(fieldInput, 'h-auto py-2')}
              rows={2}
              value={lineNote}
              onChange={(e) => setLineNote(e.target.value)}
              placeholder="この出荷だけの指示（例: 今日は化粧箱で）"
            />
          </label>

          {/* 現場メモ（中断・トラブル時に残す。事務へ伝わる）。できた数は ⏸ ボタンから素早く入力。 */}
          <div className="space-y-2 rounded border border-line bg-bg-card/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
              <StickyNote className="h-3.5 w-3.5" aria-hidden />
              現場メモ（中断・気づき）
            </p>
            <textarea
              className={cn(fieldInput, 'h-auto py-2')}
              rows={2}
              value={fieldNote}
              onChange={(e) => setFieldNote(e.target.value)}
              placeholder="何かあれば（例: 第3ハウス不調で20個で中断・続きは明日）"
            />
            <p className="text-xs text-ink-faint">
              <PauseCircle className="mr-1 inline h-3 w-3" aria-hidden />
              「できた数（中断時）」は右の ⏸ ボタンから開かずに入力できます。
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={saveDetails} isLoading={savingDetails}>
              保存
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={reset}
        title="ステータスを1段戻しますか？"
        message={`「${customerName} / ${quantityText}」を ${meta.label} から1段戻します。出荷済みを戻す場合、出荷実績は取り消されます。`}
        confirmLabel="戻す"
        isLoading={busy}
      />
    </div>
  )
}
