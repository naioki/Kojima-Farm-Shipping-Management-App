import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layouts/Sidebar'

/**
 * 圃場（staff）画面の認証ガード＋サイドバー。
 * 未認証は /login へ。role は users テーブルから取得しサイドバー出し分けに使う。
 * admin/staff 共通で /field 配下にアクセスできる（admin も現場状況を見られる）。
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} />
      <main className="flex-1 p-4 lg:p-8">{children}</main>
    </div>
  )
}
