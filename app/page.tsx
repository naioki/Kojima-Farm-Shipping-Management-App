import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * 入口の振り分け。未認証→/login、ポータル取引先→/portal/order、
 * 社内は role で admin/staff の初期画面へ。
 */
export default async function Home() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  // ポータル取引先（app_metadata.customer_id を持つ）は発注画面へ
  const customerId = (user.app_metadata as { customer_id?: string } | undefined)?.customer_id
  if (customerId) redirect('/portal/order')

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決に失敗したら現場（最小権限）に振り分ける。無言にはしない。
  if (profileErr) console.error('[app/page] ロールの取得に失敗:', profileErr.message)
  // スタッフはログイン直後に「今日の出荷」へ直行（即業務）。週次計画(matrix)は脇役。
  redirect(profile?.role === 'admin' ? '/admin' : '/field/shipments')
}
