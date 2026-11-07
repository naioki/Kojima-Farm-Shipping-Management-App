import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { ConciergeChat } from '@/components/field/ConciergeChat'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export default async function ConciergePage({
  searchParams,
}: {
  searchParams: { date?: string; product?: string }
}) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const defaultDate = shiftDateStr(jstTodayStr(), 1)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : defaultDate
  const selectedProduct = searchParams.product ?? null

  const admin = createAdminClient()
  const [profileRes, custRes, destRes, prodRes] = await Promise.all([
    admin.from('users').select('role').eq('id', user.id).maybeSingle(),
    (async () => {
      const r1 = await admin
        .from('customers')
        .select('id, name, channel_identifiers')
        .eq('is_active', true)
        .order('name')
      if (!r1.error) return r1
      return await admin.from('customers').select('id, name').eq('is_active', true).order('name')
    })(),
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name')
      .eq('is_active', true)
      .order('sort_order'),
    admin.from('products').select('id, name, unit, category').eq('is_active', true).order('name'),
  ])

  const isAdmin = profileRes.data?.role === 'admin'
  const customers = (custRes.data ?? []).map((c) => {
    const ch = (c as { channel_identifiers?: { aliases?: string[] } | null }).channel_identifiers
    return {
      id: c.id as string,
      name: c.name as string,
      aliases: Array.isArray(ch?.aliases) ? ch.aliases : undefined,
    }
  })
  const destinations = (destRes.data ?? []).map((d) => ({
    id: d.id as string,
    customer_id: (d.customer_id as string) ?? '',
    code: (d.code as string | null) ?? null,
    full_name: d.full_name as string,
  }))
  const products = (prodRes.data ?? [])
    .filter((p) => p.category !== '資材')
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      unit: p.unit as string,
    }))

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20">
      {/* 現場画面への1タップ戻りバー */}
      <div className="flex items-center justify-between gap-2 print:hidden">
        <FieldViewSwitch active="day" date={date} product={selectedProduct} />
      </div>

      {/* タイトル＆やさしい説明ヘッダー */}
      <div className="rounded-2xl bg-gradient-to-r from-forest-800 to-forest-800 p-4 sm:p-5 text-white shadow-sm space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          <h1 className="font-display text-lg sm:text-2xl font-black tracking-tight">
            AI相談窓口
          </h1>
        </div>
        <p className="text-xs sm:text-sm font-bold text-harvest-100 leading-relaxed">
          {isAdmin
            ? '細かい画面操作が苦手な方でも大丈夫！やりたいことを選ぶか話しかけるだけで、注文の追加・新しい品目や取引先の登録・設定のオン/オフをAIが代わりに準備します。'
            : 'やりたいことを えらぶか はなしかける だけで、注文の確認や追加、画面の案内を AI が てつだいます。'}
        </p>
      </div>

      <ConciergeChat
        defaultDate={date}
        isAdmin={isAdmin}
        customers={customers}
        destinations={destinations}
        products={products}
      />
    </div>
  )
}
