'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, Check, CheckCircle2, Truck, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { QuickDepartureTimeEditor } from '@/components/field/QuickDepartureTimeEditor'
import { fieldErrorMessage } from '@/lib/field/net-error'
import type { DeliveryStatus } from '@/types/database'

export interface DeliveryCheckItem {
  id: string
  productName: string
  quantityText: string
  unit: string
  noteText: string
  /** イベントのスナップショット用の生値 */
  quantity: number
}

/**
 * 配送単位（取引先＞納入先）の出発前ダブルチェックカード（配送 Phase 1）。
 *   - 明細を1行ずつタップ→全部✓で「積込OK」が押せる（指差し確認のデジタル版）
 *   - 積込OK→「納品 完了」。もどすは確認ダイアログ付き（誤タップで完了が消えない・§7と同方針）
 *   - 印刷時はチェックUIを隠し、紙用の□欄を出す（並行運用期は紙が正）
 */
export function DeliveryCheckCard({
  status,
  customerName,
  destinationName,
  items,
  deliveryDate,
  customerId,
  destinationId,
  deliveryId,
  hasPhoto,
  departureTime,
  shippingRouteName,
}: {
  status: DeliveryStatus
  customerName: string
  destinationName: string | null
  items: DeliveryCheckItem[]
  deliveryDate: string
  customerId: string
  destinationId: string | null
  /** deliveries 行が既にあるときの id（写真閲覧リンク用） */
  deliveryId: string | null
  hasPhoto: boolean
  departureTime?: string | null
  shippingRouteName?: string | null
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const allChecked = items.length > 0 && items.every((it) => checked.has(it.id))

  function toggle(id: string) {
    if (status !== 'planned') return
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function send(action: 'loaded' | 'delivered' | 'revert') {
    setBusy(true)
    try {
      const res = await fetch('/api/deliveries/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_date: deliveryDate,
          customer_id: customerId,
          destination_id: destinationId,
          action,
          items: items.map((it) => ({ product_name: it.productName, quantity: it.quantity, unit: it.unit })),
        }),
      })
      if (res.status === 409) {
        toast.error('ほかの人が更新しました。読み込み直します')
        router.refresh()
        return
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(j?.error ?? '記録できませんでした')
        return
      }
      if (action === 'loaded') toast.success('積込チェックを記録しました')
      if (action === 'delivered') toast.success('納品完了を記録しました')
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '記録できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  function revert() {
    if (window.confirm('1つ前の状態にもどしますか？')) void send('revert')
  }

  function reportIssue() {
    const note = window.prompt('どんな問題がありましたか？（例：キュウリ1ケース不足の連絡あり）')
    if (note?.trim()) {
      void (async () => {
        setBusy(true)
        try {
          const res = await fetch('/api/deliveries/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              delivery_date: deliveryDate,
              customer_id: customerId,
              destination_id: destinationId,
              action: 'issue',
              note: note.trim(),
            }),
          })
          if (res.ok) toast.success('問題を記録しました')
          else toast.error('記録できませんでした')
          router.refresh()
        } catch (e) {
          toast.error(fieldErrorMessage(e, '問題を記録できませんでした'))
        } finally {
          setBusy(false)
        }
      })()
    }
  }

  async function uploadPhoto(file: File) {
    setBusy(true)
    try {
      const form = new FormData()
      form.set('delivery_date', deliveryDate)
      form.set('customer_id', customerId)
      if (destinationId) form.set('destination_id', destinationId)
      form.set('file', file)
      const res = await fetch('/api/deliveries/photo', { method: 'POST', body: form })
      if (res.ok) toast.success('写真を保存しました')
      else toast.error('写真を保存できませんでした')
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '写真を保存できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3.5 print:break-inside-avoid print:rounded-none print:border print:border-black print:shadow-none">
      {/* カードヘッダー: 取引先・納入先、時間、ステータス */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3">
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-ink-muted">{customerName}</div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-black text-ink">
              {destinationName ? `【${destinationName}】` : customerName}
            </h2>
            <span className="rounded-md bg-bg-soft px-2 py-0.5 text-xs font-bold text-ink-soft">
              {items.length}件
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {/* 出荷時間クイック編集ボタン */}
          <QuickDepartureTimeEditor
            deliveryDate={deliveryDate}
            customerId={customerId}
            destinationId={destinationId}
            customerName={customerName}
            destinationName={destinationName}
            currentDepartureTime={departureTime ?? null}
            currentShippingRouteName={shippingRouteName ?? null}
            variant="chip"
          />

          {/* 状態バッジ */}
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-extrabold shadow-xs',
              status === 'delivered' && 'bg-emerald-100 text-emerald-800 border border-emerald-300',
              status === 'loaded' && 'bg-sky-100 text-sky-800 border border-sky-300',
              status === 'planned' && 'bg-bg-soft text-ink-soft border border-line',
            )}
          >
            {status === 'delivered' ? '✓ 納品ずみ' : status === 'loaded' ? '🚚 積込OK' : '未チェック'}
          </span>
        </div>
      </div>

      {/* ① 画面表示用：高視認性カードチェックリスト（モバイル最適化） */}
      <div className="space-y-2.5 print:hidden">
        {items
          .filter((it) => (Number(it.quantity) || 0) > 0)
          .map((it) => {
          const isChecked = status !== 'planned' || checked.has(it.id)
          return (
            <div
              key={it.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                toggle(it.id)
              }}
              className={cn(
                'rounded-xl border p-3 transition-all',
                status === 'planned' && 'cursor-pointer active:scale-[0.99]',
                isChecked
                  ? 'border-emerald-300 bg-emerald-50/50 shadow-xs'
                  : 'border-line bg-bg-card hover:border-line-strong',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  {/* 品目名 */}
                  <div className="text-base font-black text-ink leading-snug">
                    {it.productName}
                  </div>

                  {/* 箱数（コンテナ数）と入数のみを主表示 */}
                  <div className="flex flex-wrap items-baseline gap-2 pt-0.5">
                    {/* コンテナ数（箱数） */}
                    <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100/90 border border-emerald-300 px-2.5 py-1 shadow-2xs">
                      <span className="text-xs font-bold text-emerald-800">箱数:</span>
                      <span className="text-base sm:text-lg font-black text-emerald-950 tabular-nums">
                        {it.quantityText.includes('/') ? it.quantityText.split('/')[1]?.trim() : it.quantityText}
                      </span>
                    </div>

                    {/* 入数（総数量） */}
                    <div className="inline-flex items-center gap-1 rounded-lg bg-bg-soft border border-line px-2.5 py-1 text-ink">
                      <span className="text-xs font-medium text-ink-muted">入数:</span>
                      <span className="text-base font-bold tabular-nums text-trust-900">
                        {it.quantity} <span className="text-xs font-bold text-ink-soft">{it.unit}</span>
                      </span>
                    </div>
                  </div>

                  {/* その他情報は詳細欄に収納 */}
                  {it.noteText && it.noteText !== '—' && (
                    <details className="group pt-0.5 text-xs text-ink-soft">
                      <summary className="cursor-pointer select-none font-semibold text-ink-muted hover:text-ink list-none inline-flex items-center gap-1">
                        <span>詳細・メモを確認</span>
                        <span className="text-[10px] group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="mt-1 rounded-md bg-bg-soft/90 border border-line px-2.5 py-1.5 text-xs text-ink space-y-0.5">
                        <p className="font-medium">規格・指示: {it.noteText}</p>
                      </div>
                    </details>
                  )}
                </div>

                {/* 確認チェックボタン */}
                <button
                  type="button"
                  onClick={() => toggle(it.id)}
                  disabled={status !== 'planned'}
                  aria-pressed={isChecked}
                  aria-label={`${it.productName} を確認`}
                  className={cn(
                    'shrink-0 h-12 w-12 rounded-full border-2 flex items-center justify-center transition active:scale-95 shadow-xs',
                    isChecked
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-line-strong bg-white text-transparent hover:border-emerald-400',
                    status !== 'planned' && 'cursor-default',
                  )}
                >
                  <Check className="h-6 w-6 stroke-[3]" aria-hidden />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ② 紙の伝票印刷用テーブル（印刷時のみ表示） */}
      <table className="hidden print:table w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-soft print:border-black">
            <th className="py-1 pr-2 font-medium">品目</th>
            <th className="py-1 pr-2 font-medium">数量</th>
            <th className="py-1 pr-2 font-medium">荷姿・メモ</th>
            <th className="w-14 py-1 text-center font-medium">積込</th>
            <th className="w-14 py-1 text-center font-medium">納品</th>
          </tr>
        </thead>
        <tbody>
          {items
            .filter((it) => (Number(it.quantity) || 0) > 0)
            .map((it) => (
            <tr key={it.id} className="border-b border-line last:border-0 print:border-black">
              <td className="py-2.5 pr-2 font-medium text-ink">{it.productName}</td>
              <td className="num py-2.5 pr-2 tabular-nums text-ink">
                {it.quantityText}
                <span className="ml-1 text-xs text-ink-soft">{it.unit}</span>
              </td>
              <td className="py-2.5 pr-2 text-xs text-ink-soft">{it.noteText}</td>
              <td className="py-2.5 text-center text-lg leading-none text-ink-soft">□</td>
              <td className="py-2.5 text-center text-lg leading-none text-ink-soft">□</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 積込写真（任意・配送単位に1枚。誤配送クレーム時の物証） */}
      <div className="flex items-center gap-3 print:hidden">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadPhoto(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-bg-soft disabled:opacity-50"
        >
          <Camera className="h-4 w-4" aria-hidden />
          {hasPhoto ? '写真を撮りなおす' : '積込写真（任意）'}
        </button>
        {hasPhoto && deliveryId && (
          <a
            href={`/api/deliveries/photo?id=${deliveryId}`}
            target="_blank"
            rel="noopener"
            className="text-xs text-trust-600 hover:underline"
          >
            写真を見る
          </a>
        )}
      </div>

      {/* アクション（画面のみ） */}
      <div className="flex items-center justify-between gap-2 print:hidden">
        {status === 'planned' && (
          <>
            <p className="text-xs text-ink-soft">
              {allChecked ? 'ぜんぶ かくにん できました' : '1行ずつ タップして かくにん'}
            </p>
            <Button variant="primary" size="md" disabled={!allChecked} isLoading={busy} onClick={() => void send('loaded')}>
              <Truck className="h-4 w-4" aria-hidden />
              積込 OK
            </Button>
          </>
        )}
        {status === 'loaded' && (
          <>
            <button type="button" onClick={revert} className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              元に戻す
            </button>
            <Button variant="primary" size="md" isLoading={busy} onClick={() => void send('delivered')}>
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              納品完了
            </Button>
          </>
        )}
        {status === 'delivered' && (
          <>
            <div className="flex items-center gap-3">
              <button type="button" onClick={revert} className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
                <Undo2 className="h-3.5 w-3.5" aria-hidden />
                元に戻す
              </button>
              <button
                type="button"
                onClick={reportIssue}
                className="inline-flex items-center gap-1 text-xs text-warning hover:underline"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                問題を記録
              </button>
            </div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-harvest-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              この配送は完了しました
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
