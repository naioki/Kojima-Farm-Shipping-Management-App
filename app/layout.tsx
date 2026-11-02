import type { Metadata, Viewport } from 'next'
import { Noto_Sans_JP, M_PLUS_Rounded_1c, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

// next/font で自己ホスト（preload: false と adjustFontFallback: false でビルド環境でのフォント取得失敗を防止）
const body = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  variable: '--font-body',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
})
// 見出しは丸ゴシックでポップに（親しみやすさ）。本文・数字は据え置きで業務の堅さを保つ。
const display = M_PLUS_Rounded_1c({
  weight: ['700', '800'],
  variable: '--font-display',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
})
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
})

export const metadata: Metadata = {
  title: { default: '小島農園 受注ダッシュボード', template: '%s | 小島農園' },
  description: '受注・請求・収穫タスクの統合管理',
}

export const viewport: Viewport = {
  themeColor: '#b8935d',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${body.variable} ${display.variable} ${mono.variable}`}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
