import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { customerCreateSchema } from '@/types/database'
import { normalizeOrgName } from '@/lib/normalize/org-name'

export const runtime = 'nodejs'

/**
 * 現場スタッフが「スマート追加」からその場で取引先を最小登録する（Issue#20・ワンストップ拡張）。
 *
 * RLS は厳格なまま（customers への staff INSERT ポリシーは付与しない）。社内ユーザーだけを
 * サーバー側で判定し、検証済み経路を admin client（service_role）で通す。抜け道を作らないため
 * 社内ユーザー以外は 403。
 *
 * 重複防止（migrations/0022 と同じ正規化名）: 既存があれば新規作成せず既存を返す
 * （existed:true）。色・締め・規格は未設定のまま作られ、admin が後から補完する運用。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = customerCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const admin = createAdminClient()

  // 正規化名（法人格・全半角・空白ゆれ吸収）で既存照合。DB の UNIQUE INDEX(uq_customers_norm_name)
  // が最終防波堤だが、ここで既存を返して「既存に紐付けました」を UI に伝える。
  const norm = normalizeOrgName(parsed.data.name)
  const { data: allCustomers, error: listErr } = await admin.from('customers').select('id, name')
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const existing = (allCustomers ?? []).find((c) => normalizeOrgName(c.name) === norm)

  let customerId = existing?.id
  let customerName = existing?.name ?? parsed.data.name
  const existed = Boolean(existing)

  if (!existing) {
    const channelIdentifiers: Record<string, unknown> = {}
    if (parsed.data.aliases && parsed.data.aliases.length > 0) {
      channelIdentifiers.aliases = parsed.data.aliases
    }

    const { data: newCust, error: createErr } = await admin
      .from('customers')
      .insert({
        name: parsed.data.name,
        name_kana: parsed.data.name_kana ?? null,
        payment_terms: parsed.data.payment_terms ?? null,
        channel_identifiers: channelIdentifiers,
        is_active: true,
      })
      .select('id, name')
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    customerId = newCust.id
    customerName = newCust.name
  }

  // 納入先（店舗・センター）が指定されている場合は同時に登録
  let createdDestination: { id: string; label: string } | null = null
  if (customerId && parsed.data.destination_name?.trim()) {
    const destName = parsed.data.destination_name.trim()
    const { data: existingDest } = await admin
      .from('delivery_destinations')
      .select('id, full_name, code')
      .eq('customer_id', customerId)
      .eq('full_name', destName)
      .maybeSingle()

    if (existingDest) {
      createdDestination = { id: existingDest.id, label: existingDest.code || existingDest.full_name }
    } else {
      const { data: newDest, error: destErr } = await admin
        .from('delivery_destinations')
        .insert({
          customer_id: customerId,
          code: destName,
          full_name: destName,
          is_active: true,
        })
        .select('id, full_name, code')
        .single()
      if (!destErr && newDest) {
        createdDestination = { id: newDest.id, label: newDest.code || newDest.full_name }
      }
    }
  }

  // 入数（packs_per_case）が指定されている場合は品目ルールを自動生成
  let ruleCreated = false
  if (customerId && parsed.data.packs_per_case && parsed.data.packs_per_case > 0) {
    let targetProductId = parsed.data.product_id
    if (!targetProductId) {
      const { data: chingen } = await admin
        .from('products')
        .select('id')
        .eq('name', '青梗菜')
        .maybeSingle()
      targetProductId = chingen?.id
    }

    if (targetProductId) {
      const { data: existingRule } = await admin
        .from('customer_product_rules')
        .select('id')
        .eq('customer_id', customerId)
        .eq('product_id', targetProductId)
        .maybeSingle()

      if (existingRule) {
        await admin
          .from('customer_product_rules')
          .update({
            packs_per_case: parsed.data.packs_per_case,
            container_type: parsed.data.container_type || 'ケース',
            label_spec: `${parsed.data.packs_per_case}入`,
          })
          .eq('id', existingRule.id)
      } else {
        await admin.from('customer_product_rules').insert({
          customer_id: customerId,
          product_id: targetProductId,
          packs_per_case: parsed.data.packs_per_case,
          container_type: parsed.data.container_type || 'ケース',
          label_spec: `${parsed.data.packs_per_case}入`,
          has_card: false,
        })
      }
      ruleCreated = true
    }
  }

  // AI解析ルール（ai_rules）の自動シード・保存
  let aiRuleCreated = false
  const customAiRule = parsed.data.ai_rule_text?.trim()
  const hasAliases = parsed.data.aliases && parsed.data.aliases.length > 0
  const hasDest = Boolean(parsed.data.destination_name?.trim())

  if (customerId && (customAiRule || hasAliases || hasDest)) {
    const defaultAiRuleText = [
      `[発注書・入数${parsed.data.packs_per_case || 20}] 収穫・パック=出荷日前日(-1日)。`,
      `発注元『${customerName}』${hasAliases ? `『${parsed.data.aliases!.join('』『')}』` : ''}は取引先『${customerName}』として処理。`,
      `宛名『アイプラス』『小島農園』は当農園(受託側)のため取引先トリガーとしない。`,
      `チンゲン菜(青梗菜)の入数=${parsed.data.packs_per_case || 20}。`,
      hasDest ? `納入先・運送: 『${parsed.data.destination_name!.trim()}』。` : '',
      `過去の日付は除外、直近の有効納品日を抽出。`,
    ].filter(Boolean).join('')

    const ruleTextToSave = customAiRule || defaultAiRuleText

    const { data: existingAiRule } = await admin
      .from('ai_rules')
      .select('id')
      .eq('client_name', customerName)
      .maybeSingle()

    if (!existingAiRule) {
      const { error: aiErr } = await admin.from('ai_rules').insert({
        client_name: customerName,
        rule_text: ruleTextToSave,
        priority: 50,
        category: 'client_specific',
        source: 'quick_customer',
        is_active: true,
      })
      if (!aiErr) aiRuleCreated = true
    }
  }

  return NextResponse.json(
    {
      id: customerId,
      name: customerName,
      existed,
      destination: createdDestination,
      packs_per_case: parsed.data.packs_per_case,
      rule_created: ruleCreated,
      ai_rule_created: aiRuleCreated,
    },
    { status: existed ? 200 : 201 },
  )
}
