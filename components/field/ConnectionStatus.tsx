'use client'

import { useEffect, useReducer, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Wifi, Radio } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  INITIAL_CONNECTION,
  isBannerVisible,
  reduceConnection,
  type ConnectionEvent,
  type ConnectionState,
} from '@/lib/field/connection'

/**
 * 接続インジケーター。
 * ハウス・畑・配送中は電波が不安定になりやすい。
 * 偽陽性（誤判定）を防ぐため、offline イベント検知時は /api/health へのヘルスチェックで実通信を確認する。
 * 圏外時も「記録は端末に一時保存され、復帰時に自動送信されます」と正確に知らせ、現場作業員を不安にさせない。
 */

/** 復帰の知らせを出しておく時間（ms）。 */
const RECOVERED_MS = 3000

export function ConnectionStatus() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const recoveredTimer = useRef<number | null>(null)

  const [state, rawDispatch] = useReducer(
    (s: ConnectionState, e: ConnectionEvent) => reduceConnection(s, e).state,
    INITIAL_CONNECTION,
  )
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const dispatch = (e: ConnectionEvent) => {
      const { shouldRefresh } = reduceConnection(stateRef.current, e)
      rawDispatch(e)

      if (recoveredTimer.current != null) {
        window.clearTimeout(recoveredTimer.current)
        recoveredTimer.current = null
      }
      if (shouldRefresh) {
        routerRef.current.refresh()
        recoveredTimer.current = window.setTimeout(() => {
          recoveredTimer.current = null
          rawDispatch({ type: 'recovered-timeout' })
        }, RECOVERED_MS)
      }
    }

    const checkHealth = async (): Promise<boolean> => {
      try {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 2000)
        const res = await fetch('/api/health', { method: 'GET', signal: controller.signal })
        window.clearTimeout(timeout)
        return res.ok
      } catch {
        return false
      }
    }

    const goOnline = () => dispatch({ type: 'online' })
    const goOffline = async () => {
      // 偽陽性防止: ブラウザのイベントだけでなく、実通信の疎通を確認する
      const isAlive = await checkHealth()
      if (isAlive) {
        // 通信できているなら圏外と扱わない
        if (!stateRef.current.online) goOnline()
        return
      }
      dispatch({ type: 'offline' })
    }

    // 初回マウント時: navigator.onLine が false でも実疎通を確認してから判定
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      void goOffline()
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      if (recoveredTimer.current != null) window.clearTimeout(recoveredTimer.current)
    }
  }, [])

  const visible = isBannerVisible(state)

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 z-40 flex justify-center px-3 print:hidden pointer-events-none transition-opacity duration-300 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {visible && (
        <p
          className={cn(
            'flex items-center gap-2 rounded-full border px-4 py-2 text-xs sm:text-sm font-bold shadow-md',
            state.online
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-amber-300 bg-amber-50 text-amber-900',
          )}
        >
          {state.online ? (
            <>
              <Wifi className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>つながりました（最新データと同期しました）</span>
            </>
          ) : (
            <>
              <Radio className="h-4 w-4 shrink-0 text-amber-600 animate-pulse" aria-hidden />
              <span>📡 電波が不安定です — 記録は端末に一時保存され、復帰時に自動送信されます</span>
            </>
          )}
        </p>
      )}
    </div>
  )
}
