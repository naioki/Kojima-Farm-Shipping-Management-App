import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Settings } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'

export const dynamic = 'force-dynamic'

/**
 * 規格未登録一覧（マスタ健全性・pull型）。
 * 「注文実績はあるのに customer_product_rules が無い／入り数(P/C)・規格(spec)が空」の
 * 取引先×商品を洗い出す。管理者が自分のペースで埋められるようにする（鳴りっぱなしのpush通知は避ける）。
 *
 * 設計判断: 空でも常に警告は出さない。注文実績がある＝実際に使う組み合わせだけを対象にする。
 */
export default async function RulesMissingPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')
  const sb = createClient()
  const { data: profile } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="このページは管理者のみ利用できます。" />
  }

  const admin = createAdminClient()

  // 注文明細＋（注文→取引先名）＋商品名を1クエリで。キャンセルは除外。
  const { data: items } = await admin
    .from('order_items')
    .select('product_id, products(name), orders!inner(customer_id, status, customers(name))')

  // 既存ルール（入り数・規格の有無を見る）
  const { data: rules } = await admin
    .from('customer_product_rules')
    .select('customer_id, product_id, packs_per_case, spec')

  const ruleMap = new Map<string, { packs: number | null; spec: string | null }>()
  for (const r of rules ?? []) {
    ruleMap.set(`${r.customer_id}:${r.product_id}`, {
      packs: r.packs_per_case as number | null,
      spec: (r.spec as string | null) ?? null,
    })
  }

  // 注文実績のある (取引先×商品) を集計
  type Agg = {
    customerId: string
    customerName: string
    productName: string
    count: number
  }
  const seen = new Map<string, Agg>()
  for (const it of items ?? []) {
    const ord = it.orders as unknown as {
      customer_id: string
      status: string
      customers: { name: string } | null
    } | null
    const prod = it.products as unknown as { name: string } | null
    const productId = it.product_id as string | null
    if (!ord || !productId) continue
    if (ord.status === 'cancelled') continue
    const key = `${ord.customer_id}:${productId}`
    const cur = seen.get(key)
    if (cur) {
      cur.count++
    } else {
      seen.set(key, {
        customerId: ord.customer_id,
        customerName: ord.customers?.name ?? '(不明な取引先)',
        productName: prod?.name ?? '(不明な商品)',
        count: 1,
      })
    }
  }

  // 未登録（入り数 or 規格が空）だけ抽出
  const missing = [...seen.entries()]
    .map(([key, agg]) => {
      const rule = ruleMap.get(key)
      const missingPacks = !rule || rule.packs == null
      const missingSpec = !rule || rule.spec == null || rule.spec.trim() === ''
      return { ...agg, missingPacks, missingSpec, hasRule: Boolean(rule) }
    })
    .filter((m) => m.missingPacks || m.missingSpec)
    .sort(
      (a, b) =>
        a.customerName.localeCompare(b.customerName, 'ja') ||
        b.count - a.count ||
        a.productName.localeCompare(b.productName, 'ja'),
    )

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <AlertTriangle className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">規格の未登録一覧</h1>
          <p className="text-sm text-ink-soft">
            注文実績はあるのに<strong>入り数(P/C)・規格</strong>が未登録の商品です。設定しておくと、
            FAXのケース表記（例「15c2」）が自動で総数に展開され、出荷の荷姿も明確になります。
          </p>
        </div>
      </div>

      {missing.length === 0 ? (
        <Card>
          <div className="flex items-center gap-3 py-6 text-sm text-ink-soft">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-harvest-600" aria-hidden />
            注文実績のある取引先×商品はすべて規格が登録済みです。
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft text-xs text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">取引先</th>
                  <th className="px-3 py-2 text-left font-medium">商品</th>
                  <th className="px-3 py-2 text-left font-medium">未登録</th>
                  <th className="px-3 py-2 text-right font-medium">注文数</th>
                  <th className="px-3 py-2 text-right font-medium">設定</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {missing.map((m) => (
                  <tr key={`${m.customerId}:${m.productName}`}>
                    <td className="px-3 py-2 font-medium text-ink">{m.customerName}</td>
                    <td className="px-3 py-2 text-ink">{m.productName}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {m.missingPacks && (
                          <span className="rounded-full bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">
                            入り数
                          </span>
                        )}
                        {m.missingSpec && (
                          <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
                            規格
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="num px-3 py-2 text-right tabular-nums text-ink-soft">{m.count}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/customers/${m.customerId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-trust-600 hover:underline"
                      >
                        <Settings className="h-3 w-3" aria-hidden />
                        設定する
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
