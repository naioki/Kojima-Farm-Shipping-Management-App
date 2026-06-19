import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { analyzeMasterImages, type ExistingMasters } from '@/lib/gemini/master-import'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  /** data URL の接頭辞を除いた base64 と mimeType。クライアントで圧縮済み（最大1600px/JPEG）。 */
  images: z
    .array(
      z.object({
        base64: z.string().min(1),
        mimeType: z.string().min(1),
      }),
    )
    .min(1, '画像を1枚以上選択してください')
    .max(6, '画像は最大6枚までです'),
})

/**
 * 写真からマスタ一括取込：画像を Gemini に通して 3種のマスタ候補を抽出する（管理者専用）。
 * 既存マスタ（取引先/品目/規格名）を名寄せ基準としてサーバ側で注入する。
 * DB には保存しない（プレビュー）。確定は /api/master-import/commit。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'マスタ一括取込は管理者のみ利用できます' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です' },
      { status: 400 },
    )
  }

  // 既存マスタを名寄せ基準として読み込む（RLS: admin は全件可）。
  const [{ data: customers }, { data: products }, { data: packs }] = await Promise.all([
    supabase.from('customers').select('name').eq('is_active', true),
    supabase.from('products').select('id, name').eq('is_active', true),
    supabase.from('pack_configs').select('product_id, label').eq('is_active', true),
  ])

  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]))
  const standardsByProduct: Record<string, string[]> = {}
  for (const pk of packs ?? []) {
    const pName = productNameById.get(pk.product_id)
    if (!pName) continue
    ;(standardsByProduct[pName] ??= []).push(pk.label)
  }

  const existing: ExistingMasters = {
    customers: (customers ?? []).map((c) => c.name),
    products: (products ?? []).map((p) => p.name),
    standardsByProduct,
  }

  try {
    const { result, model } = await analyzeMasterImages(parsed.data.images, existing)
    return NextResponse.json({ ...result, model })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI解析に失敗しました'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
