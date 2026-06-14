'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { navFor } from '@/components/layouts/nav-items'

/** lg 以上で固定表示。それ以下は MobileNav（ハンバーガー）が担う（design.md）。色は CSS Variables。 */
export function Sidebar({ role }: { role: 'admin' | 'staff' }) {
  const pathname = usePathname()
  const nav = navFor(role)

  return (
    <nav
      aria-label="サイドメニュー"
      className="hidden w-60 shrink-0 flex-col border-r border-line bg-bg-soft p-4 lg:flex print:!hidden"
    >
      <div className="mb-6 px-2 font-display text-xl font-bold text-earth-700">小島農園</div>
      <ul className="flex-1 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded px-3 text-sm font-medium transition-colors',
                  active
                    ? 'bg-earth-100 text-earth-800'
                    : 'text-ink-soft hover:bg-bg-card hover:text-ink',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
      {/* サインアウト（POST で session 破棄→/login） */}
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="flex h-11 w-full items-center gap-3 rounded px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-bg-card hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
        >
          <LogOut className="h-5 w-5" aria-hidden />
          ログアウト
        </button>
      </form>
    </nav>
  )
}
