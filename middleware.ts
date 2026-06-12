import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * セキュリティヘッダー付与＋セッション更新（security.md）。
 * - getUser() を呼んでトークンを確実にリフレッシュ（getSession 単独は信用しない）
 * - X-Content-Type-Options / X-Frame-Options / HSTS を全レスポンスに付与
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // セッションをリフレッシュ（Server Component が古いトークンを使わないように）
  await supabase.auth.getUser()

  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return response
}

export const config = {
  // 静的アセット・画像最適化を除く全パスに適用
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
