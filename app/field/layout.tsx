import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layouts/Sidebar'
import { MobileNav } from '@/components/layouts/MobileNav'
import { FieldBottomBar, type FieldAction } from '@/components/field/FieldBottomBar'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

/**
 * 圃場（staff）画面の認証ガード＋サイドバー＋下部バー。
 * 未認証は /login へ。role は users テーブルから取得しサイドバー出し分けに使う。
 * admin/staff 共通で /field 配下にアクセスできる（admin も現場状況を見られる）。
 * 下部バーには「今日の出荷」＋解放済み機能（その他）を出す。
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'

  // 解放済み機能を「その他」ドロワーに並べる（admin は常に全許可）。
  const features = await getStaffFeatures()
  const actions: FieldAction[] = [
    { key: 'matrix', label: '計画ひょう', href: '/field/matrix', icon: 'matrix' },
  ]
  if (canStaffUse('ocr', role, features)) {
    actions.push({ key: 'ocr', label: 'OCR よみとり', href: '/field/ocr', icon: 'ocr' })
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav role={role} />
        <main className="flex-1 p-4 pb-0 lg:p-8">{children}</main>
        <FieldBottomBar actions={actions} />
      </div>
    </div>
  )
}
