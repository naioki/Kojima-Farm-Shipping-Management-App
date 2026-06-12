'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Inbox, LayoutDashboard, Sprout, FileText, Users } from 'lucide-react'
import { cn } from '@/lib/cn'

interface NavItem {
  href: string
  label: string
  icon: typeof Inbox
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/admin/inbox', label: '承認待ち', icon: Inbox },
  { href: '/admin/invoices', label: '請求', icon: FileText },
  { href: '/admin/customers', label: '取引先', icon: Users },
]

const STAFF_NAV: NavItem[] = [
  { href: '/field/matrix', label: '圃場マトリックス', icon: Sprout },
]

/** lg 以上で固定表示、それ以下はハンバーガー想定（design.md）。色は CSS Variables。 */
export function Sidebar({ role }: { role: 'admin' | 'staff' }) {
  const pathname = usePathname()
  const nav = role === 'admin' ? ADMIN_NAV : STAFF_NAV

  return (
    <nav
      aria-label="サイドメニュー"
      className="hidden w-60 shrink-0 border-r border-line bg-bg-soft p-4 lg:block"
    >
      <div className="mb-6 px-2 font-display text-xl font-bold text-earth-700">小島農園</div>
      <ul className="space-y-1">
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
    </nav>
  )
}
