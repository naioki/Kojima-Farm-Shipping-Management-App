'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFieldLang } from '@/lib/field/lang-context'
import {
  GUIDE_UI_LABELS,
  guideStorageKey,
  localizeStep,
  type GuideTour as GuideTourDef,
} from '@/lib/guide/tours'

export interface GuideTourProps {
  tour: GuideTourDef
  /** 手動で再生させたいときに親から渡す（「使い方」ボタン等）。true→再生開始、falseで待機。 */
  forceOpen?: boolean
  /** forceOpen を消費したら親へ知らせる（連続再生を防ぐ）。 */
  onForceOpenHandled?: () => void
  /** 閉じたときにフォーカスを戻す要素（「使い方」ボタン）。無ければ開く前にフォーカスしていた要素へ戻す */
  returnFocusRef?: RefObject<HTMLElement>
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/** 画面端からの余白（px） */
const EDGE = 12
/** 対象と吹き出しの間隔（px） */
const GAP = 12
/** 画面上部の固定ヘッダーぶん（対象をこれより下に出す） */
const TOP_SAFE = 72
/** 吹き出しの最大幅（px） */
const MAX_BALLOON_W = 400

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function findTarget(target: string): Element | null {
  if (typeof document === 'undefined') return null
  const all = document.querySelectorAll(`[data-guide="${target}"]`)
  // 非表示（display:none や幅0）の要素は飛ばし、見えている最初の1つを使う
  for (const found of Array.from(all)) {
    // 部品を包んだ枠に付けた場合（data-guide-measure="first-child"）は、中の最初の要素だけを照らす
    //（下の余白などまで囲ってしまわないように）
    const el =
      found.getAttribute('data-guide-measure') === 'first-child' && found.firstElementChild
        ? found.firstElementChild
        : found
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * 対象と吹き出しが両方見える位置までスクロールする。
 * 横スクロールの表（週の管理）の中にある対象もまず nearest で見える位置へ寄せる。
 */
function scrollToTarget(el: Element, balloonH: number) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight
  const usable = vh - TOP_SAFE - EDGE
  const desiredTop =
    r.height + GAP + balloonH <= usable
      ? TOP_SAFE + Math.max(0, (usable - (r.height + GAP + balloonH)) / 2)
      : TOP_SAFE
  const delta = r.top - desiredTop
  if (Math.abs(delta) > 4) {
    window.scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }
}

/** 吹き出しの位置（対象の下→上→画面下端の順に、画面からはみ出さない場所を選ぶ）。純関数。 */
export function placeBalloon(
  rect: Rect,
  balloon: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = rect.top + rect.height + GAP
  const above = rect.top - GAP - balloon.height
  let top: number
  if (below + balloon.height <= viewport.height - EDGE) top = below
  else if (above >= EDGE) top = above
  else top = viewport.height - balloon.height - EDGE
  top = Math.max(EDGE, top)
  const maxLeft = Math.max(EDGE, viewport.width - balloon.width - EDGE)
  const left = Math.min(Math.max(EDGE, rect.left), maxLeft)
  return { top, left }
}

/**
 * 現場向け操作ガイド（スポットライト＋吹き出し）。汎用実装（Issue#9）。
 * - その端末で初めて開いたとき（localStorage 未設定）に自動開始
 * - 全ステップを最後まで見た（おわり）か「この端末では次から自動で出さない」を押したときだけ、その端末で既読になる
 *   （「とじる」・背景タップ・Esc は閉じるだけ＝次に開いたときまた出る。共用タブレットの新しい人にも届くように。
 *    注文0件の日などで一部のステップしか出せなかった回は、最後まで見ても既読にしない）
 * - 対象要素は data-guide="{step.target}" で特定。見つからないステップは自動スキップ
 *   （データ0件の日でツアー対象が画面に無くても壊れない）
 * - 現場の言語切替がタイ語なら、本文・ボタンをタイ語で表示
 * - Esc で終了、role="dialog" aria-modal。開いている間は Tab で吹き出しの中だけを巡回し、
 *   閉じたら「使い方」ボタン（または開く前の要素）にフォーカスを戻す
 */
export function GuideTour({ tour, forceOpen, onForceOpenHandled, returnFocusRef }: GuideTourProps) {
  const storageKey = guideStorageKey(tour)
  const { langMode } = useFieldLang()
  const labels = GUIDE_UI_LABELS[langMode]
  const [open, setOpen] = useState(false)
  /** 開いた時点で画面に対象があるステップだけ（tour.steps の添字） */
  const [active, setActive] = useState<number[]>([])
  const [pos, setPos] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [balloonSize, setBalloonSize] = useState({ width: 0, height: 0 })
  const dialogRef = useRef<HTMLDivElement>(null)
  /** 開く直前にフォーカスしていた要素（閉じたら戻す） */
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  const start = useCallback(() => {
    const idx = tour.steps.map((s, i) => (findTarget(s.target) ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) return // 全ステップ対象なし（データ0件の日など）→ 何も出さない
    const activeEl = document.activeElement
    prevFocusRef.current = activeEl instanceof HTMLElement && activeEl !== document.body ? activeEl : null
    setActive(idx)
    setPos(0)
    setRect(null)
    setOpen(true)
  }, [tour.steps])

  // 初回自動開始（既読済みなら開かない）。画面の描画が落ち着いてから対象を探す
  useEffect(() => {
    if (typeof window === 'undefined') return
    let seen: string | null = null
    try {
      seen = window.localStorage.getItem(storageKey)
    } catch {
      return // localStorage不可（プライベートモード等）では自動表示しない（毎回出続けるのを防ぐ）
    }
    if (seen) return
    const t = window.setTimeout(start, 600)
    return () => window.clearTimeout(t)
  }, [storageKey, start])

  // 親からの再生要求（「使い方」ボタン）
  useEffect(() => {
    if (!forceOpen) return
    start()
    onForceOpenHandled?.()
  }, [forceOpen, onForceOpenHandled, start])

  const stepIndex = active[pos]
  const step = stepIndex != null ? tour.steps[stepIndex] : undefined

  // ステップが変わったら対象までスクロールし、位置を追従する
  useEffect(() => {
    if (!open || !step) return
    const el = findTarget(step.target)
    if (!el) {
      // 途中で対象が消えた（データ更新など）→ 次へ、無ければ閉じる
      if (pos < active.length - 1) setPos((p) => p + 1)
      else setOpen(false)
      return
    }
    scrollToTarget(el, dialogRef.current?.offsetHeight || 280)
    const update = () => setRect(measure(el))
    update()
    const t1 = window.setTimeout(update, 150)
    const t2 = window.setTimeout(update, 450)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, step, pos, active.length])

  // 吹き出しの実寸（文の長さ・言語で変わる）を測って配置に使う
  useLayoutEffect(() => {
    if (!open || !rect) return
    const el = dialogRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (w !== balloonSize.width || h !== balloonSize.height) setBalloonSize({ width: w, height: h })
  }, [open, rect, pos, langMode, balloonSize.width, balloonSize.height])

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      // フォーカストラップ: Tab / Shift+Tab は吹き出しの中のボタンだけを巡回する
      const root = dialogRef.current
      if (!root) return
      const items = Array.from(
        root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'),
      ).filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden')
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const current = document.activeElement
      const inside = current instanceof Node && root.contains(current)
      if (e.shiftKey) {
        if (!inside || current === first || current === root) {
          e.preventDefault()
          last.focus()
        }
      } else if (!inside || current === last || current === root) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pos])

  // 閉じたらフォーカスを「使い方」ボタン（無ければ開く前の要素）へ戻す
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    const target = returnFocusRef?.current ?? prevFocusRef.current
    target?.focus({ preventScroll: true })
  }, [open, returnFocusRef])

  function markSeen() {
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      // 保存できなくても閉じる動作自体は継続する
    }
  }

  /** この端末では次から自動で出さない */
  function dontShowAgain() {
    markSeen()
    setOpen(false)
  }

  function next() {
    if (pos >= active.length - 1) {
      // 全ステップを見せられた回だけ既読にする（一部しか出せなかった日は、次に開いたときまた出す）
      if (active.length === tour.steps.length) markSeen()
      setOpen(false)
      return
    }
    setPos((p) => p + 1)
  }

  function back() {
    if (pos > 0) setPos((p) => p - 1)
  }

  if (!open || !rect || !step) return null

  const { title, body } = localizeStep(step, langMode)
  const vw = window.innerWidth
  const vh = window.innerHeight
  const balloonW = Math.min(vw - EDGE * 2, MAX_BALLOON_W)
  const { top, left } = placeBalloon(
    rect,
    { width: balloonW, height: balloonSize.height || 280 },
    { width: vw, height: vh },
  )
  const isLast = pos >= active.length - 1

  return (
    <div className="fixed inset-0 z-[60]">
      {/* スポットライト: 全画面オーバーレイ＋対象矩形だけ box-shadow で切り抜き */}
      <div
        // 暗幕は night トークン（ダークモードでも同じ変数）。枠は outline（box-shadow と競合しない）で、
        // ダークモードでも明るい trust-400 の太枠が見える
        className="pointer-events-none fixed rounded-lg outline outline-4 outline-offset-2 outline-trust-400 [box-shadow:0_0_0_9999px_color-mix(in_srgb,var(--night)_72%,transparent)] transition-[top,left,width,height] duration-300 motion-reduce:transition-none"
        style={{
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }}
      />
      {/* 背景タップは閉じるだけ（既読にしない＝次に開いたときまた出る） */}
      <button
        type="button"
        aria-label={labels.close}
        tabIndex={-1}
        className="fixed inset-0 cursor-default"
        onClick={() => setOpen(false)}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-tour-title"
        aria-describedby="guide-tour-body"
        tabIndex={-1}
        lang={langMode === 'th' ? 'th' : 'ja'}
        className="animate-grow-in fixed z-[61] overflow-y-auto rounded-xl border-2 border-line-strong bg-bg-card p-4 shadow-xl focus:outline-none"
        style={{ top, left, width: balloonW, maxHeight: vh - EDGE * 2 }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="num text-sm font-bold text-ink-soft tabular-nums">
            {pos + 1} / {active.length}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line px-3 text-base font-bold text-ink-soft hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-400"
          >
            <X className="h-5 w-5" aria-hidden />
            <span>{labels.close}</span>
          </button>
        </div>
        <h2 id="guide-tour-title" className="mt-2 font-display text-lg font-black leading-snug text-ink">
          {title}
        </h2>
        <p id="guide-tour-body" className="mt-1.5 text-base leading-relaxed text-ink">
          {body}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={back}
            disabled={pos === 0}
            className="inline-flex min-h-12 items-center justify-center gap-1 rounded-lg border-2 border-line-strong bg-bg-card px-3 text-base font-bold text-ink hover:bg-bg-soft disabled:invisible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-400"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden />
            <span>{labels.back}</span>
          </button>
          <button
            type="button"
            onClick={next}
            className={cn(
              'inline-flex min-h-12 items-center justify-center gap-1 rounded-lg bg-earth-600 px-3 text-base font-black text-white hover:bg-earth-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-400',
            )}
          >
            <span>{isLast ? labels.done : labels.next}</span>
            {!isLast && <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />}
          </button>
        </div>
        <button
          type="button"
          onClick={dontShowAgain}
          className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg px-2 text-center text-sm font-bold text-ink-soft underline underline-offset-2 hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-400"
        >
          {labels.dontShow}
        </button>
      </div>
    </div>
  )
}
