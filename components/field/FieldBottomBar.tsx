'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PackageCheck, Grid3x3, X, ScanLine, ShoppingCart, Camera, CheckCircle2, Sprout } from 'lucide-react'
import { cn } from '@/lib/cn'

/** ドロワー項目のアイコンキー → lucide コンポーネント（server からは文字列で渡す）。 */
const ICONS = {
  matrix: Sprout,
  ocr: ScanLine,
  order: ShoppingCart,
  report: Camera,
  approve: CheckCircle2,
} as const

export type FieldActionIcon = keyof typeof ICONS

export interface FieldAction {
  key: string
  /** やさしい日本語の短いラベル */
  label: string
  href: string
  icon: FieldActionIcon
}

/**
 * 現場の下部固定バー＋「その他」ドロワー（タブレット最優先）。
 * 主役は「今日の出荷」。それ以外（計画表・OCR・注文入力・規格報告・承認）は
 * 解放済みのものだけ「その他」に大アイコンで並ぶ。やさしい日本語＋アイコンで迷わせない。
 */
export function FieldBottomBar({ actions }: { actions: FieldAction[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // ルート変更・Esc で閉じる
  useEffect(() => {
    setOpen(false)
  }, [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const onShipments = pathname.startsWith('/field/shipments')

  return (
    <>
      {/* 下部固定バー */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-bg-card/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="現場メニュー"
      >
        <Link
          href="/field/shipments"
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium',
            onShipments ? 'text-earth-700' : 'text-ink-soft',
          )}
          aria-current={onShipments ? 'page' : undefined}
        >
          <PackageCheck className="h-6 w-6" aria-hidden />
          今日の出荷
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium',
            open ? 'text-earth-700' : 'text-ink-soft',
          )}
        >
          <Grid3x3 className="h-6 w-6" aria-hidden />
          その他
        </button>
      </nav>

      {/* バー分の余白（コンテンツが隠れないように） */}
      <div className="h-16" aria-hidden style={{ height: 'calc(4rem + env(safe-area-inset-bottom))' }} />

      {/* その他ドロワー（ボトムシート） */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="その他のメニュー"
        >
          <div
            className="animate-grow-in w-full rounded-t-2xl border-t border-line bg-bg-card shadow-xl"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="font-display text-base font-bold text-ink">その他</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="rounded p-1.5 text-ink-faint hover:bg-bg-soft hover:text-ink"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            {actions.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-soft">
                使える機能はまだありません。管理者が「設定 → 現場機能の解放」でONにできます。
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 p-5">
                {actions.map((a) => {
                  const Icon = ICONS[a.icon]
                  return (
                    <Link
                      key={a.key}
                      href={a.href}
                      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-line bg-bg-soft py-5 text-center text-sm font-medium text-ink transition-transform active:scale-95 hover:border-earth-400"
                    >
                      <Icon className="h-8 w-8 text-earth-600" aria-hidden />
                      {a.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
