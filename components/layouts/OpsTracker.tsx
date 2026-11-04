'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { TICK_MS, shouldCountTick } from '@/lib/ops/active-time'

// 定期送信は5分毎（画面遷移・非表示時にも送るので取りこぼさない。行数を抑える）
const FLUSH_INTERVAL_MS = 5 * 60_000

/**
 * 画面ごとの「実際に操作していた時間」を記録する（事務作業時間の自動推定・現場観察の基盤）。
 * 画面には何も表示しない。送信失敗は業務に影響させない（記録が欠けるだけ）。
 * 記録するのは画面パスと時間のみで、入力内容（取引先名・数量など）は送らない。
 */
export function OpsTracker() {
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  const accRef = useRef(0)
  const lastInteractionRef = useRef(Date.now())

  useEffect(() => {
    function send(path: string, ms: number) {
      if (ms <= 0) return
      const body = JSON.stringify({ events: [{ path, event: 'page_active', active_ms: ms }] })
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/ops-events', new Blob([body], { type: 'application/json' }))
          return
        }
      } catch {
        /* fallthrough */
      }
      fetch('/api/ops-events', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(
        () => {},
      )
    }
    function flush() {
      const ms = accRef.current
      accRef.current = 0
      send(pathRef.current ?? '/', ms)
    }
    function markInteraction() {
      lastInteractionRef.current = Date.now()
    }

    const tick = window.setInterval(() => {
      if (
        shouldCountTick({
          visible: document.visibilityState === 'visible',
          now: Date.now(),
          lastInteractionAt: lastInteractionRef.current,
        })
      ) {
        accRef.current += TICK_MS
      }
    }, TICK_MS)
    const periodic = window.setInterval(flush, FLUSH_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
      else markInteraction()
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, markInteraction, { passive: true, capture: true }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)

    return () => {
      window.clearInterval(tick)
      window.clearInterval(periodic)
      events.forEach((e) => window.removeEventListener(e, markInteraction, { capture: true }))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  // 画面遷移: それまでの画面の時間を送ってから計測対象を切り替える
  useEffect(() => {
    if (pathRef.current !== pathname) {
      const ms = accRef.current
      accRef.current = 0
      const prev = pathRef.current
      pathRef.current = pathname
      if (ms > 0 && prev) {
        const body = JSON.stringify({ events: [{ path: prev, event: 'page_active', active_ms: ms }] })
        fetch('/api/ops-events', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(
          () => {},
        )
      }
      lastInteractionRef.current = Date.now()
    }
  }, [pathname])

  return null
}
