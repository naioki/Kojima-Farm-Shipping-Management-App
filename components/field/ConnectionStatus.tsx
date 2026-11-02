'use client'

import { useEffect, useReducer, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Wifi, Radio, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import {
  INITIAL_CONNECTION,
  isBannerVisible,
  reduceConnection,
  type ConnectionEvent,
  type ConnectionState,
} from '@/lib/field/connection'
import { useOutbox } from '@/hooks/useOutbox'

/** 復帰の知らせを出しておく時間（ms）。 */
const RECOVERED_MS = 3000

export function ConnectionStatus() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const { pendingCount, syncing, flush } = useOutbox()

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
      const isAlive = await checkHealth()
      if (isAlive) {
        if (!stateRef.current.online) goOnline()
        return
      }
      dispatch({ type: 'offline' })
    }

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

  const visible = isBannerVisible(state) || pendingCount > 0

  const handleManualFlush = async () => {
    try {
      await flush()
      router.refresh()
      toast.success('未送信データの同期を実行しました')
    } catch {
      toast.error('まだ電波が不安定です。電波の良い場所で再試行してください')
    }
  }

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
        <div
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 text-xs sm:text-sm font-bold shadow-md',
            state.online && pendingCount === 0
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-amber-300 bg-amber-50 text-amber-900',
          )}
        >
          {state.online && pendingCount === 0 ? (
            <>
              <Wifi className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>つながりました（最新データと同期しました）</span>
            </>
          ) : (
            <>
              <Radio className="h-4 w-4 shrink-0 text-amber-600 animate-pulse" aria-hidden />
              <span>
                {pendingCount > 0
                  ? `📡 端末に一時保存中の記録が ${pendingCount} 件あります`
                  : '📡 電波が不安定です — 記録は端末に一時保存され、復帰時に自動送信されます'}
              </span>
              {pendingCount > 0 && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleManualFlush}
                  className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-0.5 text-xs font-black transition active:scale-95 disabled:opacity-50"
                >
                  <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
                  <span>{syncing ? '送信中...' : '今すぐ再送信'}</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
