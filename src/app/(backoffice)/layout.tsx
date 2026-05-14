import type { ReactNode } from "react";
import Link from "next/link";
import { QueryProvider } from "@/components/QueryProvider";

export default function BackofficeLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <div className="min-h-screen bg-gray-100 flex">
        {/* サイドバー */}
        <nav className="w-56 bg-green-800 text-white flex flex-col shrink-0">
          <div className="px-4 py-5 border-b border-green-700">
            <h1 className="text-lg font-bold">🌿 農業DX</h1>
            <p className="text-xs text-green-300 mt-1">バックオフィス</p>
          </div>
          <ul className="flex-1 py-4 space-y-1">
            {[
              { href: "/(backoffice)", label: "📊 ダッシュボード" },
              { href: "/(backoffice)/orders", label: "📋 受注一覧" },
              { href: "/(backoffice)/verification-queue", label: "🔍 検証キュー" },
              { href: "/(backoffice)/invoices", label: "🧾 請求書" },
              { href: "/(backoffice)/unit-conversions", label: "⚖️ 単位換算" },
            ].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block px-4 py-2 text-sm text-green-100 hover:bg-green-700 rounded-lg mx-2 transition-colors"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-4 py-4 border-t border-green-700">
            <Link
              href="/(field)"
              className="block text-center py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            >
              圃場画面へ →
            </Link>
          </div>
        </nav>

        {/* メインコンテンツ */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6">{children}</div>
        </main>
      </div>
    </QueryProvider>
  );
}
