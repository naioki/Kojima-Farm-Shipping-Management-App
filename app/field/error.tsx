'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * 現場（タブレット・スマホ）配下のエラーバウンダリ。下部バーを残したまま、
 * 白画面にせず平易な日本語と大きめの「もう一度」ボタンを出す（NEVER swallow errors）。
 */
export default function FieldError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[field-error-boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-alert" aria-hidden />
        <h2 className="font-display text-xl font-bold text-ink">うまく ひらけませんでした</h2>
        <p className="text-sm text-ink-soft">
          いちど「もう一度」を おしてください。なおらないときは、少し まってから ためしてください。
        </p>
        <button
          onClick={reset}
          className="inline-flex h-12 min-h-[48px] items-center gap-2 rounded-lg bg-earth-500 px-6 text-base font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-trust-500 focus:ring-offset-2"
        >
          <RotateCcw className="h-5 w-5" aria-hidden />
          もう一度
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
