'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * 取引先ポータル配下のエラーバウンダリ。白画面にせず日本語の説明と「再試行」を出す
 * （NEVER swallow errors）。取引先向けなので丁寧な文面にする。
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[portal-error-boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-alert" aria-hidden />
        <h2 className="font-display text-xl font-bold text-ink">問題が発生しました</h2>
        <p className="text-sm text-ink-soft">
          一時的な不具合の可能性があります。「再試行」を押してください。解消しない場合は、
          お手数ですが時間をおいて再度お試しください。
        </p>
        <button
          onClick={reset}
          className="inline-flex h-12 min-h-[48px] items-center gap-2 rounded-lg bg-earth-500 px-6 text-sm font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-trust-500 focus:ring-offset-2"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          再試行
        </button>
        <details className="w-full text-left">
          <summary className="cursor-pointer text-xs text-ink-faint">エラーの詳細</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-3 text-xs text-ink-soft">
            {error.message}
            {error.digest ? `\nエラーID: ${error.digest}` : ''}
          </pre>
        </details>
      </div>
    </div>
  )
}
