import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { ErrorState } from '@/components/ui/States'

/**
 * 管理者専用ページの共通ガード。未認証は /login へ redirect。
 * admin でなければ ErrorState を返すので、ページ側は `if (guard) return guard` で使う。
 * null が返れば admin 確定（以降のデータ取得に進んでよい）。
 */
export async function requireAdmin(message = 'この画面は管理者のみアクセスできます。') {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決失敗は admin として扱わない（deny）。無言にせずログに残す。
  if (profileErr) console.error('[require-admin] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message={message} />
  }
  return null
}
