import type { ReactNode } from "react";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-orange-50 flex flex-col">
      <header className="bg-orange-600 text-white px-6 py-4">
        <h1 className="text-lg font-bold">🛒 注文ポータル</h1>
        <p className="text-xs text-orange-200">農業DXプラットフォーム</p>
      </header>
      <main className="flex-1 flex items-start justify-center p-6">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
