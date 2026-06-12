'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'

// react-query と react-hot-toast を全画面で使えるようにする最小 Providers。
// QueryClient は useState で生成し、再レンダーで作り直されないようにする。
export function Providers({ children }: { children: ReactNode }) {
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
