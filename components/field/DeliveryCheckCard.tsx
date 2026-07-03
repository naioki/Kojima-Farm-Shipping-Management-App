'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, Check, CheckCircle2, Truck, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
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
    } finally {
      setBusy(false)
    }
  }

  function revert() {
    // 完了の取り消しは意図的なワンクッション（誤タップで記録が消えない）
    if (window.confirm('1つ前の状態にもどしますか？')) void send('revert')
  }

  function reportIssue() {
    // 配送後の問題（数量違い・傷み・遅delay等）をその場で記録 → 配送実績に集計
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
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3 print:break-inside-avoid print:rounded-none print:border print:border-black print:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold text-ink">
          {customerName}
          {destinationName && <span className="text-ink-soft">　＞ {destinationName}</span>}
          <span className="ml-2 text-sm font-normal text-ink-soft">{items.length}件</span>
        </h2>
        {/* 状態バッジ（画面のみ） */}
        <span
          className={cn(
            'rounded-full px-3 py-1 text-xs font-bold print:hidden',
            status === 'delivered' && 'bg-harvest-100 text-harvest-700',
            status === 'loaded' && 'bg-trust-100 text-trust-700',
            status === 'planned' && 'bg-bg-soft text-ink-soft',
          )}
        >
          {status === 'delivered' ? '✓ 納品ずみ' : status === 'loaded' ? '🚚 積込OK' : '未チェック'}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-soft print:border-black">
            <th className="py-1 pr-2 font-medium">品目</th>
            <th className="py-1 pr-2 font-medium">数量</th>
            <th className="py-1 pr-2 font-medium">荷姿・メモ</th>
            <th className="hidden w-14 py-1 text-center font-medium print:table-cell">積込</th>
            <th className="hidden w-14 py-1 text-center font-medium print:table-cell">納品</th>
            <th className="w-16 py-1 text-center font-medium print:hidden">かくにん</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const isChecked = status !== 'planned' || checked.has(it.id)
            return (
              <tr
                key={it.id}
                onClick={() => toggle(it.id)}
                className={cn(
                  'border-b border-line last:border-0 print:border-black',
                  status === 'planned' && 'cursor-pointer active:bg-bg-soft',
                  status === 'planned' && checked.has(it.id) && 'bg-harvest-50',
                )}
              >
                <td className="py-2.5 pr-2 font-medium text-ink">{it.productName}</td>
                <td className="num py-2.5 pr-2 tabular-nums text-ink">
                  {it.quantityText}
                  <span className="ml-1 text-xs text-ink-soft">{it.unit}</span>
                </td>
                <td className="py-2.5 pr-2 text-xs text-ink-soft">{it.noteText}</td>
                {/* 紙用の□欄（印刷のみ） */}
                <td className="hidden py-2.5 text-center text-lg leading-none text-ink-soft print:table-cell">□</td>
                <td className="hidden py-2.5 text-center text-lg leading-none text-ink-soft print:table-cell">□</td>
                {/* 画面用のタップ確認（48pxターゲット） */}
                <td className="py-1 text-center print:hidden">
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-10 w-10 items-center justify-center rounded-full border-2',
                      isChecked
                        ? 'border-harvest-500 bg-harvest-500 text-white'
                        : 'border-line-strong bg-bg-card text-transparent',
                    )}
                  >
                    <Check className="h-6 w-6" />
                  </span>
                </td>
              </tr>
            )
          })}
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
              もどす
            </button>
            <Button variant="primary" size="md" isLoading={busy} onClick={() => void send('delivered')}>
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              納品 完了
            </Button>
          </>
        )}
        {status === 'delivered' && (
          <>
            <div className="flex items-center gap-3">
              <button type="button" onClick={revert} className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
                <Undo2 className="h-3.5 w-3.5" aria-hidden />
                もどす
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
              この配送は おわりました
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
