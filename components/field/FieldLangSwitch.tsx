'use client'

import { useFieldLang } from '@/lib/field/lang-context'
import { cn } from '@/lib/cn'

export function FieldLangSwitch({ className }: { className?: string }) {
  const { langMode, setLangMode } = useFieldLang()

  const base =
    'inline-flex min-h-10 items-center justify-center gap-1 rounded-md px-2 text-xs sm:text-sm sm:px-3 transition-all whitespace-nowrap'
  const off = 'text-ink bg-transparent hover:bg-bg-card/70'

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-line-strong bg-bg-soft p-0.5 text-sm font-black shadow-2xs print:hidden',
        className,
      )}
      role="group"
      aria-label="言語切替"
    >
      <button
        type="button"
        onClick={() => setLangMode('ja')}
        aria-pressed={langMode === 'ja'}
        className={cn(base, langMode === 'ja' ? 'bg-forest-700 text-white shadow-xs' : off)}
      >
        <span aria-hidden>🇯🇵</span>
        <span>日本語</span>
      </button>
      <button
        type="button"
        onClick={() => setLangMode('th')}
        aria-pressed={langMode === 'th'}
        className={cn(base, langMode === 'th' ? 'bg-harvest-700 text-white shadow-xs' : off)}
      >
        <span aria-hidden>🇹🇭</span>
        <span>ไทย</span>
      </button>
    </div>
  )
}
