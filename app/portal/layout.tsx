/**
 * ポータルは admin/staff と別レイアウト・別ルート（features.md §2-3）。
 * サイドバー等の社内UIは出さず、取引先向けの最小構成にする。RLS で自社データのみ可視。
 * Providers（react-query/toast）はルート app/layout.tsx で供給済みのため二重に包まない。
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <span className="font-display text-xl font-bold text-earth-700">小島農園 発注ポータル</span>
      </header>
      {children}
    </div>
  )
}
