import { redirect } from 'next/navigation'
import { Camera } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { SpecReportForm } from '@/components/field/SpecReportForm'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

/**
 * 規格の現場報告（スタッフ向け）。
 * 設定「STAFF_CAN_REPORT_SPEC」ON 時のみスタッフが使える（admin は常時可）。
 * ここからは直接マスタを編集しない。報告→管理者が確認して反映する。
 */
export default async function ReportSpecPage({
  searchParams,
}: {
  searchParams: { customerId?: string; productId?: string }
}) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'

  const features = await getStaffFeatures()
  if (!canStaffUse('reportSpec', role, features)) {
    return (
      <ErrorState
        title="まだ使えません"
        message="規格の報告は管理者が「設定 → 現場機能の解放」でONにすると使えます。"
      />
    )
  }

  const [{ data: customers }, { data: products }] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-forest-100 p-2">
          <Camera className="h-5 w-5 text-forest-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">規格を ほうこく</h1>
          <p className="text-sm text-ink-soft">
            「はこ や きかくが かわった かも」を しゃしんと メモで しらせます。へんこうは かんりしゃが かくにん します。
          </p>
        </div>
      </div>

      <Card>
        <SpecReportForm
          customers={(customers ?? []).map((c) => ({ id: c.id, name: c.name }))}
          products={(products ?? []).map((p) => ({ id: p.id, name: p.name }))}
          initialCustomerId={searchParams.customerId ?? ''}
          initialProductId={searchParams.productId ?? ''}
        />
      </Card>
    </div>
  )
}
