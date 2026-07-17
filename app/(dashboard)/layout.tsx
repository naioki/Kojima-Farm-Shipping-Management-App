import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layouts/Sidebar'
import { MobileNav } from '@/components/layouts/MobileNav'

/**
 * 認証チェック＋サイドバー（structure.md）。
 * 未認証は /login へ。role は users テーブルから取得し、サイドバーの出し分けに使う。
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle()
  // ロール解決に失敗したら最小権限（staff）にフォールバック。無言にはしない。
  if (profileErr) console.error('[dashboard/layout] ロールの取得に失敗:', profileErr.message)
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  const name = profile?.full_name?.trim() || user.email?.split('@')[0] || 'ユーザー'
  const roleLabel = role === 'admin' ? '経営者' : '現場スタッフ'

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} user={{ name, roleLabel }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav role={role} user={{ name, roleLabel }} />
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
