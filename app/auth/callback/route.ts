import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Magic Link / OAuth のコールバック（security.md：getUser で検証する前段の session 交換）。
 * `code` を session に交換し、`next` で指定された画面へ遷移する。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }
  // 失敗時はログインへ戻す（ポータル/社内の判別は next の接頭辞で）
  const loginPath = next.startsWith('/portal') ? '/portal/login' : '/login'
  return NextResponse.redirect(`${origin}${loginPath}?error=auth`)
}
