import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { MobileNav } from '@/components/layouts/MobileNav'
import { FieldBottomBar, type FieldAction } from '@/components/field/FieldBottomBar'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

/**
 * 圃場（staff）画面の認証ガード＋下部バー（タブレット最優先）。
 * 未認証は /login へ。role は users テーブルから取得しナビ出し分けに使う。
 * admin/staff 共通で /field 配下にアクセスできる（admin も現場状況を見られる）。
 * 現場は「下部バー（今日の出荷＋その他）」を主動線にし、全画面ナビは上部ハンバーガー（MobileNav
 * を persistent で常時表示）に集約する。大きいサイドバーはタブレット横で場所を食い下部バーと重複する
 * ため /field では出さない（管理者のPC全機能アクセスはハンバーガーが担う）。
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
    { key: 'delivery', label: '配送リスト', href: '/field/deliveries', icon: 'delivery' },
    { key: 'matrix', label: '週間マトリックス', href: '/field/matrix', icon: 'matrix' },
  ]
  if (canStaffUse('ocr', role, features)) {
    actions.push({ key: 'ocr', label: '注文を 読む', href: '/field/ocr', icon: 'ocr' })
  }
  if (canStaffUse('reportSpec', role, features)) {
    actions.push({ key: 'report', label: '規格を ほうこく', href: '/field/report-spec', icon: 'report' })
  }
  if (canStaffUse('approve', role, features)) {
    actions.push({ key: 'approve', label: '承認', href: '/field/approvals', icon: 'approve' })
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MobileNav role={role} persistent />
      <main className="flex-1 p-4 pb-0 lg:p-8">{children}</main>
      <FieldBottomBar actions={actions} />
    </div>
  )
}
