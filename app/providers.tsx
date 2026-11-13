'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { Toaster } from 'react-hot-toast'

/**
 * 現場画面のトーストの上端位置。
 * - ヘッダー（components/layouts/MobileNav.tsx の sticky header、h-13 = 3.25rem）
 * - main の上余白（app/field/layout.tsx の py-2 = 0.5rem）
 * - タブ（components/field/FieldViewSwitch.tsx: ボタン min-h-11 = 2.75rem ＋ 外枠 p-1×2 = 0.5rem ＋ 枠線 ≒ 0.125rem）
 * の合計 ≒ 7.125rem に少し余白を足し、iPhone の切り欠き（safe-area）ぶんも下げる。
 * タブの無い現場画面でも、ヘッダーのすぐ下あたりに出るだけで不自然にはならない。
 */
export const FIELD_TOAST_TOP = 'calc(7.5rem + env(safe-area-inset-top, 0px))'

// react-query と react-hot-toast を全画面で使えるようにする最小 Providers。
// QueryClient は useState で生成し、再レンダーで作り直されないようにする。
export function Providers({ children }: { children: ReactNode }) {
  // 現場画面のトーストは上に出す（画面下だとスマホのキーボードや下からのシート型モーダルの保存ボタンに隠れる）。
  // ただし上部のヘッダーとタブ（収穫・パック／積込・配送／週の管理）に重ならないよう、その高さぶん下げる。
  // 管理画面・ポータルは従来どおり上端。
  const isField = (usePathname() ?? '').startsWith('/field')
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* 通知トーストはデザインルールの色をそのまま使う（CSS Variables） */}
      <Toaster
        position="top-center"
        containerStyle={isField ? { top: FIELD_TOAST_TOP } : undefined}
        toastOptions={{
          style: {
            background: 'var(--bg-card)',
            color: 'var(--ink)',
            border: '1px solid var(--line-strong)',
            fontSize: '0.875rem',
          },
          success: { iconTheme: { primary: 'var(--harvest-500)', secondary: '#fff' } },
          error: { iconTheme: { primary: 'var(--alert)', secondary: '#fff' } },
        }}
      />
    </QueryClientProvider>
  )
}
