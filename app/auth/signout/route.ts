import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** サインアウト。セッションを破棄してログインへ戻す。 */
export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  const supabase = createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(`${origin}/login`, { status: 303 })
}
