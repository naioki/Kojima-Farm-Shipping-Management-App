import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { normalizeName as norm } from '@/lib/master-import/dedupe'

export const runtime = 'nodejs'

const commitSchema = z
  .object({
    products: z
      .array(
        z.object({
          name: z.string().min(1),
          name_kana: z.string().nullish(),
          base_unit: z.string().min(1).default('個'),
          tax_rate: z.union([z.literal(8), z.literal(10)]).default(8),
        }),
      )
      .default([]),
    standards: z
      .array(
        z.object({
          product_name: z.string().min(1),
          label: z.string().min(1),
          selling_unit_label: z.string().min(1),
          base_per_selling: z.number().positive(),
        }),
      )
      .default([]),
    customers: z
      .array(
        z.object({
          name: z.string().min(1),
          name_kana: z.string().nullish(),
        }),
      )
      .default([]),
  })
  .refine((d) => d.products.length + d.standards.length + d.customers.length > 0, {
    message: '登録対象が1件もありません',
  })

interface Counts {
  created: number
  skipped: number
}

/**
 * 写真からマスタ一括取込：確認画面でチェックされた項目をまとめて登録する（管理者専用）。
 * 登録順: ① 品目(products) → ② 規格(pack_configs、紐づく品目がなければ自動作成) → ③ 取引先(customers)。
 * ユニーク制約違反(23505)はエラーではなく「スキップ」として扱う。
 * 途中の想定外エラーも全体を止めず errors[] に記録して継続する（部分登録の混乱を避ける）。
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

  const parsed = commitSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です' },
      { status: 400 },
    )
  }
  const data = parsed.data

  const products: Counts = { created: 0, skipped: 0 }
  const standards: Counts = { created: 0, skipped: 0 }
  const customers: Counts = { created: 0, skipped: 0 }
  const errors: string[] = []

  // 品目名 → id の解決表（既存 + この登録で作成したもの）。
  const { data: existing } = await supabase.from('products').select('id, name')
  const productIdByNorm = new Map<string, string>()
  for (const p of existing ?? []) productIdByNorm.set(norm(p.name), p.id)

  // ① 品目
  for (const p of data.products) {
    const { data: ins, error } = await supabase
      .from('products')
      .insert({
        name: p.name,
        name_kana: p.name_kana ?? null,
        base_unit: p.base_unit,
        unit: p.base_unit, // 基準単位を正とし旧 unit も同値で揃える
        default_tax_rate: p.tax_rate,
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') products.skipped++
      else {
        products.skipped++
        errors.push(`品目「${p.name}」: ${error.message}`)
      }
      continue
    }
    productIdByNorm.set(norm(p.name), ins.id)
    products.created++
  }

  // ② 規格・荷姿（pack_configs）。紐づく品目が無ければその場で自動作成。
  for (const s of data.standards) {
    let productId = productIdByNorm.get(norm(s.product_name))
    if (!productId) {
      const { data: np, error: pe } = await supabase
        .from('products')
        .insert({ name: s.product_name, base_unit: '個', unit: '個', default_tax_rate: 8 })
        .select('id')
        .single()
      const newId = np?.id
      if (pe || !newId) {
        standards.skipped++
        errors.push(`規格「${s.label}」の品目「${s.product_name}」作成に失敗: ${pe?.message ?? ''}`)
        continue
      }
      productId = newId
      productIdByNorm.set(norm(s.product_name), newId)
      products.created++
    }
    const { error } = await supabase.from('pack_configs').insert({
      product_id: productId,
      label: s.label,
      selling_unit_label: s.selling_unit_label,
      base_per_selling: s.base_per_selling,
    })
    if (error) {
      if (error.code === '23505') standards.skipped++
      else {
        standards.skipped++
        errors.push(`規格「${s.label}」: ${error.message}`)
      }
      continue
    }
    standards.created++
  }

  // ③ 取引先
  for (const c of data.customers) {
    const { error } = await supabase
      .from('customers')
      .insert({ name: c.name, name_kana: c.name_kana ?? null })
    if (error) {
      if (error.code === '23505') customers.skipped++
      else {
        customers.skipped++
        errors.push(`取引先「${c.name}」: ${error.message}`)
      }
      continue
    }
    customers.created++
  }

  return NextResponse.json({ products, standards, customers, errors })
}
