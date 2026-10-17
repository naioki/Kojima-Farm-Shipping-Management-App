'use client'

import { RotateCw } from 'lucide-react'
import { Button } from './Button'

/**
 * ErrorState の「再試行」ボタン（クライアント島）。
 * - onRetry があればそれを呼ぶ（クライアントページ用）。
 * - 無ければページ全体を再読み込みする（サーバーコンポーネントから使う既定動作）。
 * ErrorState をサーバー/クライアント両方から使えるよう、onClick を持つ部分だけ切り出す。
 */
export function ErrorRetry({ onRetry }: { onRetry?: () => void }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => (onRetry ? onRetry() : window.location.reload())}
    >
      <RotateCw className="h-4 w-4" aria-hidden />
      再試行
    </Button>
  )
}
