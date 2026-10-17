'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { guideStorageKey, type GuideTour as GuideTourDef } from '@/lib/guide/tours'

export interface GuideTourProps {
  tour: GuideTourDef
  /** 手動で再生させたいときに親から渡す（「？」ボタン等）。true→再生開始、falseで待機。 */
  forceOpen?: boolean
  /** forceOpen を消費したら親へ知らせる（連続再生を防ぐ）。 */
  onForceOpenHandled?: () => void
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/**
 * 現場向け操作ガイド（スポットライト＋吹き出し）。汎用実装（Issue#9）。
 * - 初回は localStorage 未設定なら自動開始。「もう表示しない」で既読化
 * - 対象要素は data-guide="{step.target}" で特定。見つからないステップは自動スキップ
 *   （データ0件の日でツアー対象が画面に無くても壊れない）
 * - Esc で終了、role="dialog" aria-modal、フォーカスは吹き出し内
 */
export function GuideTour({ tour, forceOpen, onForceOpenHandled }: GuideTourProps) {
  const storageKey = guideStorageKey(tour)
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // 初回自動開始（既読済みなら開かない）
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const seen = window.localStorage.getItem(storageKey)
      if (!seen) {
        setStepIndex(0)
        setOpen(true)
      }
    } catch {
      // localStorage不可（プライベートモード等）でも画面自体は壊さない
    }
  }, [storageKey])

  // 親からの再生要求（「？」ボタン）
  useEffect(() => {
    if (!forceOpen) return
    setStepIndex(0)
    setOpen(true)
    onForceOpenHandled?.()
  }, [forceOpen, onForceOpenHandled])

  const findTarget = useCallback((target: string) => document.querySelector(`[data-guide="${target}"]`), [])

  // 対象要素が見つからないステップは自動スキップして次へ進む
  const advanceToValidStep = useCallback(
    (fromIndex: number, direction: 1 | -1) => {
      let i = fromIndex
      while (i >= 0 && i < tour.steps.length) {
        const step = tour.steps[i]
        if (step && findTarget(step.target)) return i
        i += direction
      }
      return -1
    },
    [tour.steps, findTarget],
  )

  useEffect(() => {
    if (!open) return
    const validIndex = advanceToValidStep(stepIndex, 1)
    if (validIndex === -1) {
      // 全ステップ対象なし → 何も表示せず終了（データ0件の日など）
      setOpen(false)
      return
    }
    if (validIndex !== stepIndex) {
      setStepIndex(validIndex)
      return
    }
    const step = tour.steps[validIndex]
    if (!step) return
    const el = findTarget(step.target)
    if (!el) {
      setOpen(false)
      return
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const update = () => setRect(measure(el))
    update()
    const t = window.setTimeout(update, 350) // スクロール完了後に再計測
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex, tour.steps, findTarget, advanceToValidStep])

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex])

  function markSeen() {
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      // 保存できなくても閉じる動作自体は継続する
    }
  }

  function finish() {
    markSeen()
    setOpen(false)
  }

  function next() {
    if (stepIndex >= tour.steps.length - 1) {
      finish()
      return
    }
    setStepIndex((i) => i + 1)
  }

  if (!open || !rect) return null

  const step = tour.steps[stepIndex]
  if (!step) return null

  // 吹き出しの位置：対象の下に十分な余白があれば下、無ければ上（画面外を避ける簡易ロジック）
  const balloonTop =
    rect.top + rect.height + 200 < window.innerHeight ? rect.top + rect.height + 12 : Math.max(12, rect.top - 190)

  return (
    <div className="fixed inset-0 z-[60]" aria-hidden={false}>
      {/* スポットライト: 全画面オーバーレイ＋対象矩形だけ box-shadow で切り抜き */}
      <div
        className="pointer-events-none fixed rounded-md ring-2 ring-trust-400 transition-[top,left,width,height] duration-300 motion-reduce:transition-none"
        style={{
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
          boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
        }}
      />
      {/* 背景クリックはスキップ扱い（誤操作で消えても既読化はしない＝次回また出る） */}
      <button
        type="button"
        aria-label="ガイドを閉じる"
        className="fixed inset-0 cursor-default"
        onClick={() => setOpen(false)}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-tour-title"
        tabIndex={-1}
        className="animate-grow-in fixed z-[61] w-[calc(100%-2rem)] max-w-sm rounded-lg border border-line-strong bg-bg-card p-4 shadow-xl focus:outline-none"
        style={{ top: balloonTop, left: Math.min(Math.max(12, rect.left), window.innerWidth - 340) }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-ink-faint">
            {stepIndex + 1} / {tour.steps.length}
          </p>
          <button
            type="button"
            onClick={finish}
            aria-label="ガイドを閉じる"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <h2 id="guide-tour-title" className="mt-1 font-display text-base font-bold text-ink">
          {step.title}
        </h2>
        <p className="mt-1.5 text-sm text-ink-soft">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="flex h-12 items-center rounded px-3 text-sm font-medium text-ink-faint hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            もう表示しない
          </button>
          <button
            type="button"
            onClick={next}
            className={cn(
              'flex h-12 items-center rounded bg-earth-600 px-5 text-sm font-medium text-white hover:bg-earth-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100',
            )}
          >
            {stepIndex >= tour.steps.length - 1 ? '完了' : '次へ'}
          </button>
        </div>
      </div>
    </div>
  )
}
