'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

type Theme = 'light' | 'dark'
const KEY = 'kojima-theme'
/** 同じ画面に複数の切替があっても表示をそろえるための通知 */
const EVENT = 'kojima-theme-change'

/** 端末ごとの画面の明るさ切替（localStorage。app_settings には保存しない＝他の人の端末に影響しない）。 */
export function ThemeToggle({ variant = 'dark-bg' }: { variant?: 'dark-bg' | 'light-bg' }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const read = () => setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    read()
    window.addEventListener(EVENT, read)
    return () => window.removeEventListener(EVENT, read)
  }, [])

  const apply = (next: Theme) => {
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* 保存できない環境でも画面は壊さない */
    }
  }

  const onNav = variant === 'dark-bg'
  const btn = (value: Theme, label: string) => {
    const active = theme === value
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => apply(value)}
        className={cn(
          'min-h-[40px] flex-1 rounded-lg px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-400/60',
          onNav
            ? active
              ? 'bg-forest-600 text-white'
              : 'text-forest-100/80 hover:bg-forest-700 hover:text-white'
            : active
              ? 'bg-forest-600 text-white'
              : 'bg-bg-soft text-ink-soft hover:bg-bg-card border border-line',
        )}
      >
        {label}
      </button>
    )
  }

  return (
    <div role="group" aria-label="画面の明るさ" className="px-1">
      <div className={cn('mb-1 px-2 text-xs font-bold', onNav ? 'text-forest-200' : 'text-ink-soft')}>画面の明るさ</div>
      <div className="flex gap-1">
        {btn('light', '明るい')}
        {btn('dark', '暗い')}
      </div>
    </div>
  )
}
