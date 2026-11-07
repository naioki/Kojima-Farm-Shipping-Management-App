import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { redirect } from 'next/navigation'
import { Camera, Lock } from 'lucide-react'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
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

  const supabase = createAdminClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profileErr) console.error('[field/report-spec] ロールの取得に失敗:', profileErr.message)
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'

  const features = await getStaffFeatures()
  if (!canStaffUse('reportSpec', role, features)) {
    // 故障ではないので赤いエラーではなく中立の案内にする（タイ語も併記）
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<Lock className="h-8 w-8 text-ink-faint" aria-hidden />}
          title="規格の ほうこくは まだ つかえません / ยังใช้ไม่ได้"
          description="かんりしゃが「設定 → 現場機能の解放」で オンに すると つかえます。 / ผู้ดูแลต้องเปิดใช้งานในหน้าตั้งค่าก่อน"
        />
      </div>
    )
  }

  const [{ data: customers, error: custErr }, { data: products, error: prodErr }] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
  ])

  if (custErr || prodErr) {
    return (
      <ErrorState
        message="取引先・品目を よみこめませんでした。すこし まってから もう一度 ためしてください。"
        detail={(custErr ?? prodErr)?.message}
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2 pb-1">
        <FieldViewSwitch active="day" date={shiftDateStr(jstTodayStr(), 1)} />
      </div>
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
