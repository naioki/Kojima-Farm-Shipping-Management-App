import { Bell, Sprout } from 'lucide-react'

/**
 * ポータルは admin/staff と別レイアウト・別ルート（features.md §2-3）。
 * 社内UIは出さず取引先向けの最小構成。識別色は grape（紫）＝利用者が社外で別だから。
 * Providers（react-query/toast）はルート app/layout.tsx で供給済みのため二重に包まない。
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-soft">
      <header className="sticky top-0 z-30 flex items-center gap-2.5 bg-grape-600 px-4 py-3.5 text-white shadow-sm">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
          <Sprout className="h-5 w-5" aria-hidden />
        </span>
        <span className="flex-1 truncate font-display text-lg font-bold">小島農園 発注ポータル</span>
        <Bell className="h-5 w-5" aria-hidden />
      </header>
      <main className="mx-auto max-w-xl p-4">{children}</main>
    </div>
  )
}
