'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { navFor, navGroupsFor } from '@/components/layouts/nav-items'

/**
 * モバイル用ナビ（lg 未満）。上部バー＋ハンバーガー → スライドドロワー。
 * タップ対象は大きめ（h-14・text-base）にして手袋・屋外でも押しやすくする（design.md）。
 * 画面遷移・背景タップ・×・Esc で閉じる。印刷時は非表示。
 */
export function MobileNav({ role }: { role: 'admin' | 'staff' }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const nav = navFor(role)
  const groups = navGroupsFor(role)

  // ルート変更で自動的に閉じる
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // 開いている間は背面スクロールを止める
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = nav.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))

  return (
    <>
      {/* 上部バー（モバイルのみ） */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg-soft/95 px-4 backdrop-blur lg:hidden print:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
          className="flex h-11 w-11 items-center justify-center rounded text-ink hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
        >
          <Menu className="h-6 w-6" aria-hidden />
        </button>
        <span className="font-display text-lg font-bold text-earth-700">小島農園</span>
        {current && <span className="truncate text-sm text-ink-soft">／ {current.label}</span>}
      </header>

      {/* ドロワー */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <nav
            aria-label="メニュー"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col bg-bg-soft p-4 shadow-xl animate-slide-in-left"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="px-2 font-display text-xl font-bold text-earth-700">小島農園</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="flex h-11 w-11 items-center justify-center rounded text-ink-soft hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
              >
                <X className="h-6 w-6" aria-hidden />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto">
              {groups.map((group, gi) => (
                <div key={group.label ?? `g${gi}`} className="space-y-1">
                  {group.label && (
                    <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      {group.label}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {group.items.map(({ href, label, icon: Icon }) => {
                      const active = pathname === href || pathname.startsWith(`${href}/`)
                      return (
                        <li key={href}>
                          <Link
                            href={href}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'flex h-12 items-center gap-3 rounded px-3 text-base font-medium transition-colors',
                              active ? 'bg-earth-100 text-earth-800' : 'text-ink hover:bg-bg-card',
                            )}
                          >
                            <Icon className="h-6 w-6 shrink-0" aria-hidden />
                            {label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <form action="/auth/signout" method="post" className="pt-2">
              <button
                type="submit"
                className="flex h-14 w-full items-center gap-3 rounded px-3 text-base font-medium text-ink-soft transition-colors hover:bg-bg-card hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
              >
                <LogOut className="h-6 w-6 shrink-0" aria-hidden />
                ログアウト
              </button>
            </form>
          </nav>
        </div>
      )}
    </>
  )
}
