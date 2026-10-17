'use client'

import { useEffect, useReducer, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CloudOff, Wifi } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  INITIAL_CONNECTION,
  isBannerVisible,
  reduceConnection,
  type ConnectionEvent,
  type ConnectionState,
} from '@/lib/field/connection'

/**
 * 接続インジケーター（features.md §10 失敗#4「接続インジケーター常時表示」）。
 *
 * ハウス・畑・配送中は電波が切れる。切れていることに気づかないままタップし続けると、
 * 「保存できていない」ことに気づかないまま作業が終わる（＝出荷実績が残らない）。
 * 下部バーの真上に固定表示し、圏外の間はずっと出す。復帰したら短く知らせて自動で消え、
 * その際にサーバーデータを取り直す（圏外の間に事務所側で変わった数量を拾う）。
 *
 * 表示の判断ロジックは lib/field/connection.ts（テスト済みの純粋関数）に置く。
 * ここはイベント購読・タイマー・見た目だけを持つ。
 *
 * 位置は FieldBottomBar（高さ 4rem ＋ セーフエリア）の真上に合わせる。
 * env(safe-area-inset-bottom) は Tailwind で表現できないため、FieldBottomBar と同じく
 * inline style を使う（design.md のインラインstyle禁止の例外＝セーフエリア対応）。
 */

/** 復帰の知らせを出しておく時間（ms）。読めるだけの長さで、作業の邪魔はしない。 */
const RECOVERED_MS = 3000

export function ConnectionStatus() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const recoveredTimer = useRef<number | null>(null)

  // 純粋関数の遷移を React に載せる。副作用（再取得・タイマー）は dispatch 側で拾う。
  const [state, rawDispatch] = useReducer(
    (s: ConnectionState, e: ConnectionEvent) => reduceConnection(s, e).state,
    INITIAL_CONNECTION,
  )
  // 遷移の副作用を判定するため、同じ入力でもう一度純粋関数を通す必要がある。
  // reducer は純粋に保ちたいので、現在値を ref に持って dispatch のラッパで判定する。
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
        // 圏外の間にサーバー側で変わっているかもしれない（事務所の数量修正・承認）。
        // 復帰時に取り直して、現場が古い数字のまま梱包するのを防ぐ。
        routerRef.current.refresh()
        recoveredTimer.current = window.setTimeout(() => {
          recoveredTimer.current = null
          rawDispatch({ type: 'recovered-timeout' })
        }, RECOVERED_MS)
      }
    }

    const goOnline = () => dispatch({ type: 'online' })
    const goOffline = () => dispatch({ type: 'offline' })

    // マウント時点で既に圏外なら、その場で帯を出す
    if (navigator.onLine === false) goOffline()

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
    // aria-live は常にマウントしておく（表示時に初めて現れる要素は読み上げられないため）
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 z-40 flex justify-center px-3 print:hidden',
        // 横いっぱいに広がる帯なので、常にタップを透過させる。そうしないと
        // 表示中は帯の下にある出荷行のタップを奪ってしまう（中身は押す要素ではない）。
        'pointer-events-none',
        'transition-opacity duration-300 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
    >
      {visible && (
        <p
          className={cn(
            'flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold shadow-md',
            state.online
              ? 'border-harvest-200 bg-harvest-50 text-harvest-700'
              : 'border-alert/40 bg-warning-bg text-alert',
          )}
        >
          {state.online ? (
            <>
              <Wifi className="h-4 w-4 shrink-0" aria-hidden />
              つながりました
            </>
          ) : (
            <>
              <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
              電波が ありません — きろくは ほぞんされません
            </>
          )}
        </p>
      )}
    </div>
  )
}
