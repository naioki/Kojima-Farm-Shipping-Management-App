'use client'

import { useFieldLang } from '@/lib/field/lang-context'
import { cn } from '@/lib/cn'

export function FieldLangSwitch({ className }: { className?: string }) {
  const { langMode, setLangMode } = useFieldLang()

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg bg-black/20 p-0.5 border border-white/20 text-xs font-black shadow-2xs print:hidden',
        className,
      )}
      role="group"
      aria-label="言語モード切替"
    >
      <button
        type="button"
        onClick={() => setLangMode('ja')}
        className={cn(
          'px-2 py-0.5 rounded-md transition-all flex items-center gap-1',
          langMode === 'ja'
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-white/80 hover:text-white hover:bg-white/10',
        )}
      >
        <span>🇯🇵</span>
        <span className="hidden sm:inline">日本語</span>
      </button>
      <button
        type="button"
        onClick={() => setLangMode('th')}
        className={cn(
          'px-2 py-0.5 rounded-md transition-all flex items-center gap-1',
          langMode === 'th'
            ? 'bg-emerald-500 text-white shadow-xs font-black'
            : 'text-white/80 hover:text-white hover:bg-white/10',
        )}
      >
        <span>🇹🇭</span>
        <span>ไทย</span>
      </button>
    </div>
  )
}
