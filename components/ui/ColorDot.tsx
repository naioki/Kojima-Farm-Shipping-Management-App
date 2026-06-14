import { cn } from '@/lib/cn'

/** 取引先の識別色から確定的な色を返す（display_color 未設定時のフォールバック） */
const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b',
]

export function colorFromName(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

interface ColorDotProps {
  /** 保存された16進数カラー（null = name から自動割り当て） */
  color?: string | null
  /** 色が null のときのフォールバック計算に使う名前 */
  name: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 取引先識別の小さな色丸。
 * タスク画面で「どの取引先か」を色だけで瞬時に判断できるようにする（文字より高速）。
 * サイズ: sm=14px（行内インライン）、md=20px（ヘッダー・ラベル）
 */
export function ColorDot({ color, name, size = 'sm', className }: ColorDotProps) {
  const resolvedColor = color ?? colorFromName(name)
  const sizeClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5'
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full', sizeClass, className)}
      style={{ backgroundColor: resolvedColor }}
      aria-hidden
    />
  )
}
