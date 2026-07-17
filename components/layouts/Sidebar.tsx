'use client'

import Link from 'next/link'
import { LogOut, ChevronDown, Leaf, UserRound } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useNavState } from '@/components/layouts/use-nav'

export interface SidebarUser {
  name: string
  roleLabel: string
}

/** lg 以上で固定表示。それ以下は MobileNav（ハンバーガー）が担う（design.md）。深緑のナビ地。 */
export function Sidebar({ role, user }: { role: 'admin' | 'staff'; user?: SidebarUser }) {
  const { groups, activeHref, openGroups, toggleGroup } = useNavState(role)

  return (
    <nav
      aria-label="サイドメニュー"
      className="hidden w-60 shrink-0 flex-col overflow-y-auto bg-forest-800 p-3 text-forest-100 lg:flex print:!hidden"
    >
      {/* ロゴ */}
      <div className="mb-4 flex items-center gap-2.5 px-2 pt-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-forest-600 text-white">
          <Leaf className="h-5 w-5" aria-hidden />
        </span>
        <div className="leading-tight">
          <div className="font-display text-lg font-bold text-white">小島農園</div>
          <div className="text-[11px] text-forest-200">タスク管理</div>
        </div>
      </div>

      <div className="flex-1 space-y-1.5">
        {groups.map((group, gi) => {
          const items = (
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = href === activeHref
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-400/60',
                        active
                          ? 'bg-forest-600 text-white shadow-sm'
                          : 'text-forest-100/80 hover:bg-forest-700 hover:text-white',
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )

          // 見出し無し（ダッシュボード・設定）は折りたたまず常に表示
          if (!group.label) {
            return <div key={`g${gi}`}>{items}</div>
          }

          const open = openGroups[group.label] ?? false
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggleGroup(group.label!)}
                aria-expanded={open}
                className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-forest-200 transition-colors hover:text-white"
              >
                {group.label}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
              </button>
              {open && <div className="mt-0.5">{items}</div>}
            </div>
          )
        })}
      </div>

      {/* ユーザーチップ */}
      {user && (
        <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-forest-700/60 px-3 py-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forest-500 text-white">
            <UserRound className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium text-white">{user.name}</div>
            <div className="text-[11px] text-forest-200">{user.roleLabel}</div>
          </div>
        </div>
      )}

      {/* サインアウト（POST で session 破棄→/login） */}
      <form action="/auth/signout" method="post" className="mt-1">
        <button
          type="submit"
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-forest-100/80 transition-colors hover:bg-forest-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-400/60"
        >
          <LogOut className="h-5 w-5" aria-hidden />
          ログアウト
        </button>
      </form>
    </nav>
  )
}
