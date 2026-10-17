import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'

/**
 * サーバー（Server Component / Route Handler）用 Supabase クライアント。
 * Cookie 経由でユーザーセッションを引き継ぐ。RLS が効く anon キーで動作。
 * 認証検証は必ず getUser()（getSession 単独は信用しない・security.md）。
 */
export function createClient() {
  const cookieStore = cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Component から呼ばれた場合は set 不可。middleware 側で更新するため無視。
          }
        },
      },
    },
  )
}

/**
 * 認証済みユーザーを取得する。未認証なら null。
 * Route Handler / Server Component の冒頭で必ず呼ぶ（security.md）。
 */
export async function getAuthedUser() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
