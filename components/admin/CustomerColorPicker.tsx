'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { ColorDot, colorFromName } from '@/components/ui/ColorDot'

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b',
  '#64748b', '#84cc16',
]

interface CustomerColorPickerProps {
  customerId: string
  customerName: string
  initialColor: string | null
}

/**
 * 取引先の識別色を設定するミニUIコンポーネント。
 * タスク画面で「どの取引先の作業か」を色で即時判断できるようにする。
 */
export function CustomerColorPicker({ customerId, customerName, initialColor }: CustomerColorPickerProps) {
  const [color, setColor] = useState<string | null>(initialColor)
  const [saving, setSaving] = useState(false)
  const autoColor = colorFromName(customerName)

  async function save(newColor: string | null) {
    setSaving(true)
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_color: newColor }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `更新失敗 (${res.status})`)
      }
      setColor(newColor)
      toast.success('識別色を保存しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ColorDot color={color} name={customerName} size="md" />
        <span className="text-sm text-ink">
          {color ? color : `自動 (${autoColor})`}
        </span>
        {color && (
          <button
            type="button"
            onClick={() => void save(null)}
            disabled={saving}
            className="text-xs text-ink-faint hover:text-ink-soft underline"
          >
            リセット
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => void save(c)}
            disabled={saving}
            aria-label={c}
            className={cn(
              'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-trust-400',
              color === c ? 'border-ink scale-110' : 'border-transparent',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <p className="text-xs text-ink-faint">
        出荷一覧・注文入力でこの色が取引先の識別に使われます。
      </p>
    </div>
  )
}
