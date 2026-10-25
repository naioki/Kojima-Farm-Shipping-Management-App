'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, RotateCw, Printer, Clock, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'
import { FieldLangSwitch } from '@/components/field/FieldLangSwitch'
import { useFieldLang } from '@/lib/field/lang-context'
import {
  CustomerDeliveryCard,
  type CustomerDeliveryCardProps,
} from '@/components/field/CustomerDeliveryCard'

export interface DeliveriesBoardViewProps {
  date?: string
  initialCards: (CustomerDeliveryCardProps & {
    earliestDepartureTime: string | null
  })[]
}

export function DeliveriesBoardView({ date, initialCards }: DeliveriesBoardViewProps) {
  const router = useRouter()
  const { isThaiMode } = useFieldLang()
  const [cards, setCards] = useState(initialCards)
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete'>('all')
  const [groupMode, setGroupMode] = useState<'route' | 'customer'>('route')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const prevSignatureRef = useRef<string>('')

  // 初期カードから署名を作成し、パック作業完了や数量変更を検知した際にトースト通知
  useEffect(() => {
    setCards(initialCards)
    const sig = initialCards
      .map((c) => {
        const destSig = c.destinations
          .map(
            (d) =>
              `${d.destinationId}:${d.totalQty}:${d.items.map((i) => `${i.id}:${i.fieldStatus}:${i.quantity}`).join(',')}`,
          )
          .join('|')
        return `${c.customerId}:${c.totalQty}:${destSig}`
      })
      .join(';')
    if (prevSignatureRef.current && prevSignatureRef.current !== sig) {
      toast('🔔 最新のパック状況・注文データが反映されました', {
        id: 'delivery-board-auto-sync',
        duration: 3000,
      })
    }
    prevSignatureRef.current = sig
  }, [initialCards])

  // 🔄 30秒おきのバックグラウンド自動同期 ＋ 画面復帰時（focus/visibilitychange）の即時最新化
  useEffect(() => {
    const syncLatest = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        router.refresh()
      }
    }
    const timer = setInterval(syncLatest, 30_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    window.addEventListener('focus', syncLatest)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', syncLatest)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router])

  const handleRefresh = () => {
    setIsRefreshing(true)
    router.refresh()
    setTimeout(() => {
      setIsRefreshing(false)
      toast.success('最新の配送リストを取得しました', { id: 'delivery-refresh' })
    }, 600)
  }

  const handleCompletionChange = (customerId: string, isCompleted: boolean) => {
    setCards((prev) =>
      prev.map((c) => (c.customerId === customerId ? { ...c, isCompleted } : c)),
    )
  }

  const totalCustomers = cards.length
  const completedCustomers = cards.filter((c) => c.isCompleted).length
  const remainingCustomers = totalCustomers - completedCustomers

  const totalContainers = cards.reduce((acc, c) => acc + c.grandTotalContainers, 0)
  const completedContainers = cards
    .filter((c) => c.isCompleted)
    .reduce((acc, c) => acc + c.grandTotalContainers, 0)
  const remainingContainers = Math.max(0, totalContainers - completedContainers)
  const progressPct =
    totalCustomers > 0 ? Math.min(100, Math.round((completedCustomers / totalCustomers) * 100)) : 0

  const effectiveDate = date || initialCards[0]?.deliveryDate || jstTodayStr()
  const isToday = effectiveDate === jstTodayStr()
  const isTomorrow = effectiveDate === shiftDateStr(jstTodayStr(), 1)

  const visibleCards =
    filterMode === 'incomplete' ? cards.filter((c) => !c.isCompleted) : cards

  // 便・時間帯ごとのグルーピング（便別順モード用）
  const routeGroups = (() => {
    const map = new Map<
      string,
      {
        key: string
        title: string
        departureTime: string | null
        isUnassigned: boolean
        cards: typeof visibleCards
      }
    >()

    for (const c of visibleCards) {
      const primaryRoute = c.routeSummaries?.[0]
      const depTime = c.earliestDepartureTime || primaryRoute?.departureTime || null
      const rawTitle = primaryRoute?.title || '一般配送・時間未指定'
      const isUnassigned = !depTime && (rawTitle === '一般配送・時間未指定' || !rawTitle)
      const groupTitle = isUnassigned
        ? '時間未設定（マスタ設定で次回から不要）'
        : depTime && !rawTitle.includes(depTime)
        ? `${depTime}発 ${rawTitle}`
        : rawTitle
      const groupKey = isUnassigned ? '__unassigned__' : `${depTime ?? '99:99'}:${groupTitle}`

      let grp = map.get(groupKey)
      if (!grp) {
        grp = {
          key: groupKey,
          title: groupTitle,
          departureTime: depTime,
          isUnassigned,
          cards: [],
        }
        map.set(groupKey, grp)
      }
      grp.cards.push(c)
    }

    const list = Array.from(map.values())
    list.sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1
      if (a.departureTime && b.departureTime) {
        const cmp = a.departureTime.localeCompare(b.departureTime)
        if (cmp !== 0) return cmp
      } else if (a.departureTime && !b.departureTime) {
        return -1
      } else if (!a.departureTime && b.departureTime) {
        return 1
      }
      return a.title.localeCompare(b.title, 'ja')
    })
    return list
  })()

  return (
    <div className="space-y-3.5">
      {/* 印刷時専用タイトルヘッダー */}
      <div className="hidden print:flex items-center justify-between border-b-2 border-black pb-2 mb-3">
        <div>
          <h2 className="text-lg font-black text-black">
            🚚 小島農園 便別積込・配送リスト（{formatJpDateShort(effectiveDate)} 出荷分）
          </h2>
          <p className="text-xs font-bold text-slate-700">
            全 {totalCustomers} 取引先 ／ 総積込数 {totalContainers} 箱
          </p>
        </div>
        <div className="text-xs font-bold text-slate-700">
          積込済: {completedCustomers} / {totalCustomers} 社
        </div>
      </div>

      {/* スクロール追従スティッキーヘッダー（パック画面と完全統一された日付・積込進捗・ワンタップ更新バー） */}
      <div
        className={cn(
          'sticky top-14 z-20 -mx-1 px-3 py-2 text-white backdrop-blur shadow-md rounded-b-xl border-b transition-colors duration-200 print:hidden',
          isToday
            ? 'bg-[#0c2e4e]/95 border-sky-600/80'
            : isTomorrow
            ? 'bg-[#0f2e1e]/95 border-emerald-600/80'
            : 'bg-[#1e293b]/95 border-slate-600',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          {/* 左側: 日付・作業区分バッジ */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-black shadow-2xs shrink-0',
                isToday
                  ? 'bg-sky-400 text-sky-950'
                  : isTomorrow
                  ? 'bg-emerald-400 text-emerald-950'
                  : 'bg-slate-700 text-slate-100 border border-slate-500',
              )}
            >
              <span>🚚</span>
              <span>
                {isToday
                  ? `本日 ${formatJpDateShort(effectiveDate)} 積込・配送分`
                  : isTomorrow
                  ? `明日 ${formatJpDateShort(effectiveDate)} 出荷（本日パック中）`
                  : `${formatJpDateShort(effectiveDate)} 積込・配送分`}
              </span>
            </span>
          </div>

          {/* 右側: リアルタイム積込進捗 ＆ ワンタップ更新・印刷 */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
            <span className="text-emerald-300 font-black tabular-nums text-xs sm:text-sm">
              {completedCustomers}/{totalCustomers} 社済
            </span>
            <span className="text-[11px] text-slate-300 font-bold tabular-nums">
              ({progressPct}%)
            </span>
            <span
              className="hidden xs:inline-block rounded-md bg-white/15 border border-white/20 px-2 py-0.5 text-[11px] text-white font-black tabular-nums"
              title={`残り積込 ${remainingContainers}箱`}
            >
              {remainingCustomers > 0
                ? `あと ${remainingCustomers}社 (計${remainingContainers}箱)`
                : `全${totalContainers}箱 積込完了`}
            </span>
            <FieldLangSwitch />
            <button
              type="button"
              onClick={() => window.print()}
              title="積込リストを印刷"
              aria-label="積込リストを印刷"
              className="flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/20 active:bg-white/30 px-1.5 py-0.5 text-xs text-white/90 border border-white/15 transition"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline text-[11px] font-bold">印刷</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="最新データを再取得"
              aria-label="最新データを再取得"
              className="flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/20 active:bg-white/30 px-1.5 py-0.5 text-xs text-white/90 border border-white/15 transition disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
              <span className="hidden sm:inline text-[11px] font-bold">更新</span>
            </button>
          </div>
        </div>
      </div>

      {/* 進捗サマリー ＆ 表示順（便別順 / 取引先順） ＆ ワンタップ未積込フィルタ */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-earth-200 bg-earth-50 px-3.5 py-2.5 print:hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-ink-soft">積込進捗:</span>
          <span className="text-ink font-bold text-xs sm:text-sm flex items-center">
            <span className="num text-xl font-black tabular-nums text-earth-700 mr-0.5">
              {completedCustomers}
            </span>
            <span className="mx-0.5 text-ink-muted">/</span>
            <span>{totalCustomers} 取引先</span>
            <span className="ml-1.5 text-xs text-ink-soft font-semibold">
              （計 {totalContainers} 箱）
            </span>
            {remainingCustomers > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 text-xs font-black">
                残り {remainingCustomers}社 ({remainingContainers}箱)
              </span>
            ) : (
              <span className="ml-2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 text-xs font-black inline-flex items-center gap-0.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> 全積込完了
              </span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 便別順 / 取引先順 切替スイッチ */}
          <div className="inline-flex items-center rounded-lg bg-white/80 p-0.5 border border-earth-200 text-xs font-bold shadow-2xs">
            <button
              type="button"
              onClick={() => setGroupMode('route')}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition',
                groupMode === 'route'
                  ? 'bg-earth-700 text-white shadow-2xs'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              <Clock className="h-3 w-3" />
              <span>便・時間順{isThaiMode ? ' (เวลา)' : ''}</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupMode('customer')}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition',
                groupMode === 'customer'
                  ? 'bg-earth-700 text-white shadow-2xs'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              <Building2 className="h-3 w-3" />
              <span>取引先順{isThaiMode ? ' (ลูกค้า)' : ''}</span>
            </button>
          </div>

          {/* ワンタップ絞り込みスイッチ（すべて / 未積込のみ） */}
          <div className="inline-flex items-center rounded-lg bg-white/80 p-0.5 border border-earth-200 text-xs font-bold shadow-2xs">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={cn(
                'px-2.5 py-1 rounded-md transition',
                filterMode === 'all'
                  ? 'bg-forest-700 text-white shadow-2xs'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              {isThaiMode ? 'すべて(ทั้งหมด)' : 'すべて'} ({totalCustomers})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('incomplete')}
              className={cn(
                'px-2.5 py-1 rounded-md transition',
                filterMode === 'incomplete'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-ink-soft hover:text-ink',
              )}
            >
              {isThaiMode ? '未積込(ยังไม่ขึ้น)' : '未積込のみ'} ({remainingCustomers})
            </button>
          </div>
        </div>
      </div>

      {/* 取引先カード一覧（便別見出し付き or 取引先フラット一覧） */}
      {visibleCards.length === 0 && filterMode === 'incomplete' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center space-y-2">
          <p className="text-base font-black text-emerald-900">
            🎉 すべての取引先の積込チェックが完了しています！
          </p>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className="inline-flex items-center rounded-lg bg-white border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition"
          >
            完了済みのカードを表示する
          </button>
        </div>
      ) : groupMode === 'route' ? (
        <div className="space-y-5">
          {routeGroups.map((grp) => {
            const grpTotalBoxes = grp.cards.reduce((acc, c) => acc + c.grandTotalContainers, 0)
            const grpRemBoxes = grp.cards
              .filter((c) => !c.isCompleted)
              .reduce((acc, c) => acc + c.grandTotalContainers, 0)
            const grpAllDone = grp.cards.every((c) => c.isCompleted)
            return (
              <div key={grp.key} className="space-y-2.5">
                {/* 便・時間帯ごとのセクション見出しバー */}
                <div
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2 border shadow-2xs',
                    grpAllDone
                      ? 'border-slate-300 bg-slate-100 text-slate-600'
                      : grp.isUnassigned
                      ? 'border-slate-300 bg-slate-100 text-slate-800'
                      : 'border-earth-300 bg-earth-100/90 text-earth-950',
                  )}
                >
                  <div className="flex items-center gap-2 font-black text-sm">
                    <span>{grp.isUnassigned ? '📦' : '⏰'}</span>
                    <span>{grp.title}</span>
                    <span className="text-xs font-bold opacity-80">
                      （{grp.cards.length}社）
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-black">
                    {grpAllDone ? (
                      <span className="rounded-md bg-emerald-600 text-white px-2 py-0.5">
                        ✓ 全{grpTotalBoxes}箱 積込済
                      </span>
                    ) : (
                      <span className="rounded-md bg-white/90 border border-earth-300 px-2.5 py-0.5 text-earth-900">
                        残り {grpRemBoxes} 箱 ／ 計 {grpTotalBoxes} 箱
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {grp.cards.map((c) => (
                    <CustomerDeliveryCard
                      key={c.customerId}
                      {...c}
                      onCompletionChange={handleCompletionChange}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCards.map((c) => (
            <CustomerDeliveryCard
              key={c.customerId}
              {...c}
              onCompletionChange={handleCompletionChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
