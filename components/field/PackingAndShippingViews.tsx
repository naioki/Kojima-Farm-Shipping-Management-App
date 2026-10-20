'use client'

import { useState } from 'react'
import { Truck, Package, Clock, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
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

export function PackingAndShippingViews({
  items: initialItems,
  date,
  isAdmin,
}: PackingAndShippingViewsProps) {
  const [activeTab, setActiveTab] = useState<'pack' | 'ship'>('pack')
  const [items, setItems] = useState<ShipmentItemData[]>(initialItems)
  const [busyReorder, setBusyReorder] = useState<boolean>(false)

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

  // 上下移動（パック作業順）
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    if (busyReorder) return
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

  // 出荷画面用グループ化: 出発便・時間別（時間の早い順に自動ソート）
  const routeGroups = new Map<string, ShipmentItemData[]>()
  for (const it of items) {
    const timePrefix = it.departureTime || '時間未設定'
    const routeSuffix = it.shippingRouteName ? ` ${it.shippingRouteName}` : ''
    const key = it.shippingRouteName || it.departureTime
      ? `${timePrefix}${routeSuffix}`.trim()
      : '通常便 (定期)'
    const arr = routeGroups.get(key) ?? []
    arr.push(it)
    routeGroups.set(key, arr)
  }

  // 時間順にソート（例: "08:00" -> "11:00" -> "14:00" -> "通常便" -> "時間未設定"）
  const sortedRouteEntries = Array.from(routeGroups.entries()).sort(([keyA], [keyB]) => {
    const isUnsetA = keyA.includes('時間未設定') || keyA.includes('通常便')
    const isUnsetB = keyB.includes('時間未設定') || keyB.includes('通常便')
    if (isUnsetA && !isUnsetB) return 1
    if (!isUnsetA && isUnsetB) return -1
    return keyA.localeCompare(keyB, 'ja', { numeric: true })
  })

  return (
    <div className="space-y-4">
      {/* 画面モード切替タブ（大きなフォント・押しやすい高さ） */}
      <div className="grid grid-cols-2 rounded-2xl bg-slate-200/90 p-1.5 text-base font-bold shadow-inner">
        <button
          type="button"
          onClick={() => setActiveTab('pack')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl py-3 transition-all active:scale-98',
            activeTab === 'pack'
              ? 'bg-white text-emerald-900 shadow-md font-black text-base'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          <Package className="h-5 w-5 text-emerald-600" />
          <span>🛍️ 袋詰め（パック）画面</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ship')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl py-3 transition-all active:scale-98',
            activeTab === 'ship'
              ? 'bg-white text-sky-950 shadow-md font-black text-base'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          <Truck className="h-5 w-5 text-sky-600" />
          <span>🚚 出荷（便・積込）画面</span>
        </button>
      </div>

      {/* ────────────────────────────────────── */}
      {/* ① 袋詰め（パック）画面 */}
      {/* ────────────────────────────────────── */}
      {activeTab === 'pack' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-bold text-ink">
              📋 作業順（{isAdmin ? '▲▼で並び替え可能' : '上から順番にパック'}）
            </span>
            <span className="text-sm font-bold text-ink-soft">全 {sortedPackItems.length} 件</span>
          </div>

          <div className="space-y-3">
            {sortedPackItems.map((item, idx) => (
              <ShipmentRow
                key={item.itemId}
                {...item}
                deliveryDate={date}
                isAdmin={isAdmin}
                onMoveUp={idx > 0 ? () => handleMove(idx, 'up') : undefined}
                onMoveDown={idx < sortedPackItems.length - 1 ? () => handleMove(idx, 'down') : undefined}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* ────────────────────────────────────── */}
      {/* ② 出荷（便・積込）画面 */}
      {/* ────────────────────────────────────── */}
      {activeTab === 'ship' && (
        <div className="space-y-4">
          {/* 出荷ヘッダー（分かりやすい案内） */}
          <div className="flex items-center justify-between rounded-xl border border-sky-300 bg-sky-50/80 p-3.5">
            <div className="flex items-center gap-2.5">
              <Clock className="h-5 w-5 text-sky-700" />
              <span className="text-sm sm:text-base font-black text-sky-950">出発便・時間順グループ</span>
            </div>
            <span className="text-xs sm:text-sm font-bold text-sky-900 bg-sky-100 rounded-lg px-2.5 py-1">
              早い便から順番に積込
            </span>
          </div>

          {/* 便別グループカード一覧（早い便から順に表示） */}
          {sortedRouteEntries.map(([routeName, groupItems]) => {
            const unshippedCount = groupItems.filter((i) => i.initialStatus !== 'shipped').length
            const isGroupDone = unshippedCount === 0

            return (
              <div
                key={routeName}
                className={cn(
                  'rounded-2xl border p-4 shadow-sm space-y-3 transition-all',
                  isGroupDone
                    ? 'border-emerald-200 bg-emerald-50/20 opacity-80'
                    : 'border-sky-300 bg-white border-l-4 border-l-sky-500 shadow-md',
                )}
              >
                <div className="flex items-center justify-between border-b border-line/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-sky-100 px-2.5 py-1 text-sm font-black text-sky-950">
                      🕒 {routeName}
                    </span>
                    {!isGroupDone && (
                      <span className="inline-flex items-center rounded-md bg-sky-600 px-2 py-0.5 text-xs font-black text-white">
                        🚚 積込中
                      </span>
                    )}
                    <span className="text-sm font-bold text-ink-soft">({groupItems.length}件)</span>
                  </div>
                  {isGroupDone ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" /> 積込完了
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 border border-rose-300 px-2.5 py-1 text-xs font-black text-rose-700">
                      未積込 {unshippedCount} 件
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {groupItems.map((item) => (
                    <ShipmentRow
                      key={item.itemId}
                      {...item}
                      deliveryDate={date}
                      isAdmin={isAdmin}
                      showShippingButton={true}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
