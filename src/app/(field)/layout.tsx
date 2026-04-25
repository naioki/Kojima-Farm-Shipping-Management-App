import type { ReactNode } from "react";
import { OfflineIndicator } from "@/components/field/OfflineIndicator";
import { QueryProvider } from "@/components/QueryProvider";

export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <OfflineIndicator />
        <header className="bg-green-700 text-white px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold">🌿 圃場出荷管理</h1>
        </header>
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </QueryProvider>
  );
}
