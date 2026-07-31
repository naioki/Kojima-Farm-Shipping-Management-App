'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CloudOff, Wifi } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 接続インジケーター（features.md §10 失敗#4「接続インジケーター常時表示」）。
 *
 * ハウス・畑・配送中は電波が切れる。切れていることに気づかないままタップし続けると、
 * 「保存できていない」ことに気づかないまま作業が終わる（＝出荷実績が残らない）。
 * 下部バーの真上に固定表示し、圏外の間はずっと出す。復帰したら短く知らせて自動で消え、
 * その際にサーバーデータを取り直す（圏外の間に事務所側で変わった数量を拾う）。
 *
 * 位置は FieldBottomBar（高さ 4rem ＋ セーフエリア）の真上に合わせる。
 * env(safe-area-inset-bottom) は Tailwind で表現できないため、
 * FieldBottomBar と同じく inline style を使う（design.md のインラインstyle禁止の
 * 例外＝セーフエリア対応。他の見た目はすべてトークンで指定する）。
 */

/** 復帰トーストを出しておく時間（ms）。読めるだけの長さで、作業の邪魔はしない。 */
const RECOVERED_MS = 3000

export function ConnectionStatus() {
  const router = useRouter()
  // 初期値は online。SSR と初回描画を一致させ、一瞬「圏外」が出るのを防ぐ。
  const [online, setOnline] = useState(true)
  // 一度でも切れたか。切れていないのに「つながりました」を出さないための記録。
  const wasOffline = useRef(false)
  const [recovered, setRecovered] = useState(false)
  const recoveredTimer = useRef<number | null>(null)

  useEffect(() => {
    const goOffline = () => {
      wasOffline.current = true
      setRecovered(false)
      if (recoveredTimer.current != null) {
        window.clearTimeout(recoveredTimer.current)
        recoveredTimer.current = null
      }
      setOnline(false)
    }

    const goOnline = () => {
      setOnline(true)
      if (!wasOffline.current) return // 最初からオンライン。何も出さない
      wasOffline.current = false
      setRecovered(true)
      // 圏外の間にサーバー側で変わっているかもしれない（事務所の数量修正・承認）。
      // 復帰時に取り直して、現場が古い数字のまま梱包するのを防ぐ。
      router.refresh()
      recoveredTimer.current = window.setTimeout(() => {
        recoveredTimer.current = null
        setRecovered(false)
      }, RECOVERED_MS)
    }

    // マウント時点の実際の状態を反映（すでに圏外で開いた場合もバーを出す）
    if (navigator.onLine === false) goOffline()

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      if (recoveredTimer.current != null) window.clearTimeout(recoveredTimer.current)
    }
  }, [router])

  const visible = !online || recovered

  return (
    // aria-live は常にマウントしておく（表示時に初めて現れる要素は読み上げられないため）
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 z-40 flex justify-center px-3 print:hidden',
        'transition-opacity duration-300 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
    >
      {visible && (
        <p
          className={cn(
            'flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold shadow-md',
            online
              ? 'border-harvest-200 bg-harvest-50 text-harvest-700'
              : 'border-alert/40 bg-warning-bg text-alert',
          )}
        >
          {online ? (
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
