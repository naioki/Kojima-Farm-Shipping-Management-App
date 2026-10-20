'use client'

import { useEffect, useState } from 'react'
import { ShipmentRow, type ShipmentRowProps } from '@/components/field/ShipmentRow'
import toast from 'react-hot-toast'
import type { FieldStatus } from '@/types/database'

export interface ShipmentItemData extends ShipmentRowProps {
  itemId: string
  dailyPackSortOrder?: number | null
  defaultPackSortOrder?: number
  shippingRouteName?: string | null
  departureTime?: string | null
  orderedQty: number
  quantityText: string
  destinationName: string
  customerName: string
  statusText?: string
  isChanged?: boolean
  changeText?: string
}

interface PackingAndShippingViewsProps {
  items: ShipmentItemData[]
  date: string
  isAdmin: boolean
}

/**
 * 収穫・袋詰め（パック）専用の明細カード一覧ビュー。
 * - 画面切替は画面最上部のタブ（収穫・袋詰めボード ⇋ 便別積込・配送リスト）に一本化。
 * - 重複していた下部の「袋詰め/出荷」切り替えバーは完全撤去し、作業カードの表示領域を最大化。
 * - 並び替え（▲▼）は管理者（isAdmin）時のみ表示し、現場作業員の通常操作やスクロール時の誤タップ・エラー通知を根絶。
 */
export function PackingAndShippingViews({
  items: initialItems,
  date,
  isAdmin,
}: PackingAndShippingViewsProps) {
  const [items, setItems] = useState<ShipmentItemData[]>(initialItems)
  const [busyReorder, setBusyReorder] = useState<boolean>(false)

  // サーバー側や親コンポーネント（日付変更・品目タブ切り替え）から届く最新の明細リストを確実に同期
  useEffect(() => {
    setItems(initialItems)
  }, [initialItems])

  // パック画面用ソート: 管理者指定順 (dailyPackSortOrder) -> 納品先デフォルト順 (defaultPackSortOrder)
  const sortedPackItems = [...items].sort((a, b) => {
    const orderA = a.dailyPackSortOrder ?? a.defaultPackSortOrder ?? 100
    const orderB = b.dailyPackSortOrder ?? b.defaultPackSortOrder ?? 100
    return orderA - orderB
  })

  // ステータス即時連動（タップした瞬間に親Stateの initialStatus と initialVersion を即座に更新）
  const handleStatusChange = (itemId: string, newStatus: FieldStatus, newVersion: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.itemId === itemId ? { ...it, initialStatus: newStatus, initialVersion: newVersion } : it,
      ),
    )
  }

  // 管理者による上下移動（パック作業順）
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    if (!isAdmin || busyReorder) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= sortedPackItems.length) return

    // 他行のステータス変更を上書きしないよう、IDとソート順のみのスナップショットを保持
    const prevSortMap = new Map(items.map((it) => [it.itemId, it.dailyPackSortOrder]))
    const newSorted = [...sortedPackItems]
    const temp = newSorted[index]!
    newSorted[index] = newSorted[targetIndex]!
    newSorted[targetIndex] = temp

    // 新しい sortOrder を割り振る
    const updates = newSorted.map((it, idx) => ({
      id: it.itemId,
      sortOrder: (idx + 1) * 10,
    }))

    // 楽観的更新
    const updatedMap = new Map(updates.map((u) => [u.id, u.sortOrder]))
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        dailyPackSortOrder: updatedMap.get(it.itemId) ?? it.dailyPackSortOrder,
      })),
    )

    setBusyReorder(true)
    try {
      const res = await fetch('/api/order-items/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updates }),
      })
      if (!res.ok) throw new Error('並び順の保存に失敗しました')
      toast.success('パック作業順を更新しました')
    } catch (e) {
      toast.error('並び替えに失敗しました')
      // dailyPackSortOrder のみを安全にロールバック
      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          dailyPackSortOrder: prevSortMap.get(it.itemId) ?? it.dailyPackSortOrder,
        })),
      )
    } finally {
      setBusyReorder(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 作業順ヘッダー案内 */}
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-bold text-ink">
          📋 作業順（{isAdmin ? '▲▼で並び替え可能' : '上から順番にパック'}）
        </span>
        <span className="text-sm font-bold text-ink-soft">全 {sortedPackItems.length} 件</span>
      </div>

      {/* パック作業カード一覧 */}
      <div className="space-y-3">
        {sortedPackItems.map((item, idx) => (
          <ShipmentRow
            key={item.itemId}
            {...item}
            deliveryDate={date}
            isAdmin={isAdmin}
            onMoveUp={isAdmin && !busyReorder && idx > 0 ? () => handleMove(idx, 'up') : undefined}
            onMoveDown={isAdmin && !busyReorder && idx < sortedPackItems.length - 1 ? () => handleMove(idx, 'down') : undefined}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>
    </div>
  )
}
