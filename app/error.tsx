'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * ルート共通のエラーバウンダリ。予期しない例外で白画面にせず、
 * 日本語の説明と「再試行」を必ず出す（NEVER swallow errors）。
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[error-boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-alert" aria-hidden />
        <h2 className="font-display text-xl font-bold text-ink">エラーが発生しました</h2>
        <p className="text-sm text-ink-soft">
          一時的な問題の可能性があります。再試行しても直らない場合は、ページを再読み込みするか
          時間をおいて再度お試しください。
        </p>
        {error.digest && <p className="font-mono text-xs text-ink-faint">エラーID: {error.digest}</p>}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-earth-500 px-4 py-2 text-sm font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-trust-500 focus:ring-offset-2"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          再試行
        </button>
      </div>
    </div>
  )
}
