'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { useFieldLang } from '@/lib/field/lang-context'
import { getThaiDepartureTime } from '@/lib/field/thai-dict'
import { cleanShippingRouteName } from '@/lib/field/shipment-sort'

interface Props {
  deliveryDate: string
  customerId: string
  destinationId: string | null
  customerName: string
  destinationName: string | null
  currentDepartureTime: string | null
  currentShippingRouteName: string | null
  /** トリガーの見た目：'button' (通常ボタン) または 'chip' (時間バッジ風) */
  variant?: 'button' | 'chip'
}

const FARM_PRESETS = [
  {
    label: '🔥 当日 16:00迄（NSK）',
    time: '16:00',
    route: 'NSK便',
  },
  {
    label: '🚚 当日 18:00迄（和郷園）',
    time: '18:00',
    route: '和郷園便',
  },
  {
    label: '🌅 翌午前迄（農業総研）',
    time: '翌午前',
    route: '農業総研便',
  },
  {
    label: '📦 時間指定なし（一般便）',
    time: '',
    route: '',
  },
]

const COMMON_TIMES = ['16:00', '18:00', '翌午前', '翌09:00', '翌11:00', '11:30', '14:00']
const COMMON_ROUTES = ['NSK便', '和郷園便', '農業総研便', '岩槻便', '戸田便', '直売所便']

export function QuickDepartureTimeEditor({
  deliveryDate,
  customerId,
  destinationId,
  customerName,
  destinationName,
  currentDepartureTime,
  currentShippingRouteName,
  variant = 'button',
}: Props) {
  const router = useRouter()
  const { isThaiMode } = useFieldLang()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [time, setTime] = useState(currentDepartureTime ?? '')
  const [route, setRoute] = useState(cleanShippingRouteName(currentShippingRouteName) ?? '')
  const [scope, setScope] = useState<'master' | 'date_only'>('master')

  function handleOpen() {
    setTime(currentDepartureTime ?? '')
    setRoute(cleanShippingRouteName(currentShippingRouteName) ?? '')
    setScope('master')
    setOpen(true)
  }

  async function handleSave() {
    setBusy(true)
    try {
      const res = await fetch('/api/deliveries/departure-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryDate,
          customerId,
          destinationId,
          destinationName,
          departureTime: time.trim() || null,
          shippingRouteName: route.trim() || null,
          scope,
        }),
      })

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存に失敗しました (${res.status})`)
      }

      toast.success(
        scope === 'master'
          ? time.trim()
            ? `出荷時間を ${time}（今後ずっと共通）に設定しました`
            : '出荷時間・便名（今後ずっと共通）を更新しました'
          : `${deliveryDate} 当日限定で出荷時間・便名を更新しました`,
      )
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '出荷時間の設定に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  // チップ表示ラベルの組み立て（時刻と便名の重複を防止しつつ分かりやすく表示）
  const chipLabel = (() => {
    const cleanRoute = cleanShippingRouteName(currentShippingRouteName)
    const isNextDayTime = currentDepartureTime?.startsWith('翌')
    if (currentDepartureTime && cleanRoute) {
      return isNextDayTime ? `${currentDepartureTime}迄・${cleanRoute}` : `当日${currentDepartureTime}迄・${cleanRoute}`
    }
    if (currentDepartureTime) {
      return isNextDayTime ? `${currentDepartureTime}迄に出荷` : `当日${currentDepartureTime}迄に出荷`
    }
    if (cleanRoute) {
      return cleanRoute
    }
    return '時間指定なし（設定可）'
  })()

  const thaiTime = isThaiMode ? getThaiDepartureTime(currentDepartureTime) : null

  return (
    <>
      {variant === 'chip' ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleOpen()
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold transition active:scale-95 print:border-slate-400 print:bg-white',
            currentDepartureTime?.startsWith('翌')
              ? 'bg-sky-50 hover:bg-sky-100 border-sky-300 text-sky-900'
              : currentDepartureTime || currentShippingRouteName
              ? 'bg-earth-100 hover:bg-earth-200 border-earth-300 text-earth-900'
              : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700',
          )}
          title="出荷時間・便名を変更（一度設定すれば次回以降も自動引き継ぎ）"
        >
          <Clock className="h-3 w-3 text-earth-700 shrink-0" />
          {thaiTime ? (
            <>
              <span className="text-xs sm:text-sm font-black">{thaiTime}</span>
              <span className="text-[11px] font-bold opacity-85">({chipLabel})</span>
            </>
          ) : (
            <span>{chipLabel}</span>
          )}
          <span className="text-[10px] text-earth-700 underline ml-0.5 print:hidden">変更</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleOpen()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg-card hover:bg-bg-soft px-2.5 py-1 text-xs font-bold text-ink-soft transition active:scale-95 print:hidden"
        >
          <Clock className="h-3.5 w-3.5 text-earth-600" />
          <span>出荷時間</span>
        </button>
      )}

      {/* モーダルダイアログ */}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:hidden"
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-bg-card p-5 shadow-2xl border border-line space-y-3.5 animate-scale-in max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between border-b border-line pb-2.5">
              <div>
                <h3 className="font-display text-base font-black text-ink">出荷時間・便名のかんたん設定</h3>
                <p className="text-xs text-ink-soft mt-0.5">
                  {customerName}
                  {destinationName && <span className="font-bold text-ink"> ＞ {destinationName}</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-ink-soft hover:bg-bg-soft"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 保存範囲（今後ずっと共通 vs この日だけ） */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-ink">
                📌 適用範囲（毎回入力しなくてOK）
              </label>
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-bg-soft p-1 border border-line">
                <button
                  type="button"
                  onClick={() => setScope('master')}
                  className={cn(
                    'rounded-lg py-1.5 px-2 text-xs font-black transition',
                    scope === 'master'
                      ? 'bg-forest-700 text-white shadow-2xs'
                      : 'text-ink-soft hover:text-ink',
                  )}
                >
                  🔁 今後ずっと共通
                </button>
                <button
                  type="button"
                  onClick={() => setScope('date_only')}
                  className={cn(
                    'rounded-lg py-1.5 px-2 text-xs font-black transition',
                    scope === 'date_only'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'text-ink-soft hover:text-ink',
                  )}
                >
                  📅 この日({deliveryDate.slice(5)})だけ
                </button>
              </div>
              <p className="text-[11px] text-ink-muted">
                {scope === 'master'
                  ? '💡 一度設定すれば、明日以降も自動で同じ時刻・便名が引き継がれます。'
                  : '💡 今日・この日だけの臨時変更として保存します（翌日以降は元に戻ります）。'}
              </p>
            </div>

            {/* 小島農園 定番プリセット（1タップで時刻＋便名を同時セット） */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-ink">
                ⚡ 定番プリセット（1タップ設定）
              </label>
              <div className="grid grid-cols-1 gap-1.5">
                {FARM_PRESETS.map((p) => {
                  const isSelected = time === p.time && route === p.route
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setTime(p.time)
                        setRoute(p.route)
                      }}
                      className={cn(
                        'flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-black transition active:scale-98 text-left',
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-600'
                          : 'border-line bg-white hover:bg-bg-soft text-ink',
                      )}
                    >
                      <span>{p.label}</span>
                      {isSelected && <Check className="h-4 w-4 text-emerald-700 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 出荷時間（出発時刻） */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-ink">
                ⏰ 出荷時間（自由指定も可能）
              </label>
              <div className="flex items-center gap-2">
                <input
                  type={time.startsWith('翌') ? 'text' : 'time'}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="num h-10 w-full rounded-xl border border-line-strong bg-bg-card px-3 text-base font-bold text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100"
                />
                {time && (
                  <button
                    type="button"
                    onClick={() => setTime('')}
                    className="h-10 px-2.5 rounded-xl border border-line text-xs font-medium text-ink-muted hover:bg-bg-soft shrink-0"
                  >
                    クリア
                  </button>
                )}
              </div>
              {/* クイック時間選択チップ */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setTime('')}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-bold transition active:scale-95',
                    !time
                      ? 'bg-earth-700 text-white shadow-xs'
                      : 'bg-bg-soft text-ink hover:bg-line',
                  )}
                >
                  時間未指定
                </button>
                {COMMON_TIMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTime(t)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-bold transition active:scale-95',
                      time === t
                        ? 'bg-earth-700 text-white shadow-xs'
                        : 'bg-bg-soft text-ink hover:bg-line',
                    )}
                  >
                    {t.startsWith('翌') ? t : `${t}発`}
                  </button>
                ))}
              </div>
            </div>

            {/* 便名・ルート */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-ink">
                🚚 便名・ルート名
              </label>
              <input
                type="text"
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                placeholder="例: 岩槻便, 1便, 直売所便"
                className="h-10 w-full rounded-xl border border-line-strong bg-bg-card px-3 text-sm font-bold text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100"
              />
              {/* クイック便名選択チップ */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {COMMON_ROUTES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoute(r)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-bold transition active:scale-95',
                      route === r
                        ? 'bg-trust-700 text-white shadow-xs'
                        : 'bg-bg-soft text-ink hover:bg-line',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* ボタン */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="h-10 rounded-xl border border-line px-4 text-xs font-bold text-ink-soft hover:bg-bg-soft"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                className="h-10 rounded-xl bg-forest-700 hover:bg-forest-800 text-white px-5 text-xs font-black shadow-sm flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                <span>{busy ? '保存中...' : '設定を保存'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
