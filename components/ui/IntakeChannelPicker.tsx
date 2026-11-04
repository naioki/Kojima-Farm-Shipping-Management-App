'use client'

import { useEffect } from 'react'
import { Phone, MessageCircle, FileText, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ManualIntakeChannel = 'phone' | 'line' | 'paper' | 'other'

const OPTIONS: { value: ManualIntakeChannel; label: string; Icon: typeof Phone }[] = [
  { value: 'phone', label: '電話', Icon: Phone },
  { value: 'line', label: 'LINE', Icon: MessageCircle },
  { value: 'paper', label: '紙・口頭', Icon: FileText },
  { value: 'other', label: 'その他', Icon: MoreHorizontal },
]

const STORAGE_KEY = 'kojima.lastIntakeChannel'

/** 前回選んだ受注経路（端末ごと）。無ければ null。 */
export function loadLastIntakeChannel(): ManualIntakeChannel | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'phone' || v === 'line' || v === 'paper' || v === 'other' ? v : null
  } catch {
    return null
  }
}

/**
 * 手入力注文の受注経路（電話・LINE・紙・その他）を1タップで選ぶ。
 * 評価指標「紙・電話・LINE からの卒業」を測るための入力。前回の選択を端末に記憶して初期値にする。
 */
export function IntakeChannelPicker({
  value,
  onChange,
  className,
}: {
  value: ManualIntakeChannel | null
  onChange: (v: ManualIntakeChannel) => void
  className?: string
}) {
  // 初回のみ前回の選択を復元
  useEffect(() => {
    if (value == null) {
      const last = loadLastIntakeChannel()
      if (last) onChange(last)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function select(v: ManualIntakeChannel) {
    onChange(v)
    try {
      window.localStorage.setItem(STORAGE_KEY, v)
    } catch {
      /* 記憶できなくても選択自体は有効 */
    }
  }

  return (
    <div className={cn('space-y-1', className)}>
      <span id="intake-channel-label" className="block text-sm font-medium text-ink">
        受注経路<span className="ml-1 text-xs text-ink-soft">（どこから来た注文か）</span>
      </span>
      <div role="radiogroup" aria-labelledby="intake-channel-label" className="flex flex-wrap gap-2">
        {OPTIONS.map(({ value: v, label, Icon }) => {
          const selected = value === v
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => select(v)}
              className={cn(
                'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-trust-500 focus:ring-offset-2',
                selected
                  ? 'border-earth-600 bg-earth-600 text-white dark:border-earth-500 dark:bg-earth-500'
                  : 'border-line bg-bg-card text-ink hover:bg-bg-soft',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
