'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, LogOut, ChevronDown, Leaf, UserRound } from 'lucide-react'
import { cn } from '@/lib/cn'
import { navFor } from '@/components/layouts/nav-items'
import { useNavState } from '@/components/layouts/use-nav'
import type { SidebarUser } from '@/components/layouts/Sidebar'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * モバイル用ナビ（lg 未満）。上部バー＋ハンバーガー → スライドドロワー。
 * タップ対象は大きめ（h-14・text-base）にして手袋・屋外でも押しやすくする（design.md）。
 * 画面遷移・背景タップ・×・Esc で閉じる。印刷時は非表示。
 * ドロワーは role="dialog" + フォーカストラップ（開時に閉じるボタンへ、Tab循環、閉時にハンバーガーへ復帰）。
 */
export function MobileNav({
  role,
  persistent = false,
  user,
}: {
  role: 'admin' | 'staff'
  persistent?: boolean
  user?: SidebarUser
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const nav = navFor(role)
  const { groups, activeHref, openGroups, toggleGroup } = useNavState(role)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  // ルート変更で自動的に閉じる
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // 開いている間は背面スクロールを止める・Escで閉じる
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

  // フォーカストラップ：開時に閉じるボタンへフォーカス、Tabで循環、閉時にハンバーガーへ復帰
  useEffect(() => {
    if (!open) {
      menuButtonRef.current?.focus()
      return
    }
    closeButtonRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !drawerRef.current) return
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const current = nav.find((n) => n.href === activeHref)

  return (
    <>
      {/* 上部バー（モバイル／現場は常時） */}
      <header
        className={cn(
          'sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg-soft/95 px-4 backdrop-blur print:hidden',
          !persistent && 'lg:hidden',
        )}
      >
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
          className="flex h-11 w-11 items-center justify-center rounded text-ink hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
        >
          <Menu className="h-6 w-6" aria-hidden />
        </button>
        <span className="inline-flex items-center gap-1.5 font-display text-lg font-bold text-forest-700">
          <Leaf className="h-5 w-5" aria-hidden />
          小島農園
        </span>
        {current && <span className="truncate text-sm text-ink-soft">／ {current.label}</span>}
      </header>

      {/* ドロワー */}
      {open && (
        <div className={cn('fixed inset-0 z-50', !persistent && 'lg:hidden')}>
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <nav
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col bg-forest-800 p-4 text-forest-100 shadow-xl animate-slide-in-left"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 px-1 font-display text-xl font-bold text-white">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-forest-600">
                  <Leaf className="h-5 w-5" aria-hidden />
                </span>
                小島農園
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-forest-100/80 hover:bg-forest-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-400/60"
              >
                <X className="h-6 w-6" aria-hidden />
              </button>
            </div>
            {user && (
              <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-forest-700/60 px-3 py-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forest-500 text-white">
                  <UserRound className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm font-medium text-white">{user.name}</div>
                  <div className="text-[11px] text-forest-200">{user.roleLabel}</div>
                </div>
              </div>
            )}
            <div className="flex-1 space-y-2 overflow-y-auto">
              {groups.map((group, gi) => {
                const items = (
                  <ul className="space-y-1">
                    {group.items.map(({ href, label, icon: Icon }) => {
                      const active = href === activeHref
                      return (
                        <li key={href}>
                          <Link
                            href={href}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'flex h-12 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors',
                              active ? 'bg-forest-600 text-white' : 'text-forest-100/80 hover:bg-forest-700 hover:text-white',
                            )}
                          >
                            <Icon className="h-6 w-6 shrink-0" aria-hidden />
                            {label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )
                if (!group.label) return <div key={`g${gi}`}>{items}</div>
                const gOpen = openGroups[group.label] ?? false
                return (
                  <div key={group.label}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label!)}
                      aria-expanded={gOpen}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-forest-200 hover:text-white"
                    >
                      {group.label}
                      <ChevronDown className={cn('h-4 w-4 transition-transform', gOpen && 'rotate-180')} aria-hidden />
                    </button>
                    {gOpen && <div className="mt-1">{items}</div>}
                  </div>
                )
              })}
            </div>
            <form action="/auth/signout" method="post" className="pt-2">
              <button
                type="submit"
                className="flex h-14 w-full items-center gap-3 rounded-lg px-3 text-base font-medium text-forest-100/80 transition-colors hover:bg-forest-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-400/60"
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
