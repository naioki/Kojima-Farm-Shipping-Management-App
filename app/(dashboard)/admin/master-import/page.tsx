import { Images } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { MasterImportWizard, type ExistingForDedup } from '@/components/admin/MasterImportWizard'
import { requireAdmin } from '@/lib/auth/require-admin'
import { ErrorState } from '@/components/ui/States'

export const dynamic = 'force-dynamic'

/**
 * 写真でマスタ登録（管理者専用）。
 * 紙の台帳・取引先一覧・規格表を撮影し、店舗・品目・規格をまとめて抽出 → 確認 → 一括登録。
 * 既存マスタ名は重複判定（名寄せ）のためクライアントへ渡す。
 */
export default async function MasterImportPage() {
  const guard = await requireAdmin('写真でマスタ登録は管理者のみ利用できます。')
  if (guard) return guard

  const supabase = createAdminClient()

  const [
    { data: customers, error: customersErr },
    { data: products, error: productsErr },
    { data: packs, error: packsErr },
  ] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('products').select('id, name').eq('is_active', true),
    supabase.from('pack_configs').select('product_id, label').eq('is_active', true),
  ])

  // 重複判定の元データが欠けたまま登録に進むと二重登録になるため、空表示にせずエラーで止める
  const queryError = customersErr ?? productsErr ?? packsErr
  if (queryError) return <ErrorState message="既存マスタを読み込めませんでした。時間をおいて再度お試しください。" detail={queryError.message} />

  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]))
  const existing: ExistingForDedup = {
    customers: (customers ?? []).map((c) => c.name),
    products: (products ?? []).map((p) => p.name),
    standards: (packs ?? [])
      .map((pk) => ({ product_name: productNameById.get(pk.product_id) ?? '', label: pk.label }))
      .filter((s) => s.product_name),
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <Images className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">写真でマスタ登録</h1>
          <p className="text-sm text-ink-soft">
            紙の取引先一覧・品目台帳・規格表を撮影すると、AIが店舗・品目・規格をまとめて読み取ります。
            確認・編集してから一括登録します（管理者専用）。
          </p>
        </div>
      </div>

      <Card>
        <MasterImportWizard
          existing={existing}
          parentOptions={(customers ?? []).map((c) => ({ id: c.id, name: c.name }))}
        />
      </Card>
    </div>
  )
}
