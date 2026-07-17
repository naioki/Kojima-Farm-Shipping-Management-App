import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { customerProductRuleUpsertSchema } from '@/types/database'
import { getSetting } from '@/lib/settings'
import { canEditRules, parseMasterEmails } from '@/lib/rules/permission'
import { formatRuleChanges, summarizeRuleChanges } from '@/lib/rules/format'
import { writeAudit } from '@/lib/audit/log'
import { notify } from '@/lib/notify'
import { buildChannelsFromSettings } from '@/lib/notify/from-settings'

export const runtime = 'nodejs'

/**
 * 取引先×商品の取引ルール（規格）upsert。(customer_id, product_id) 一意。
 * ガバナンス（features/ユーザー要望）:
 *   - RULES_EDIT_LOCK on のときはマスター（RULES_MASTER_EMAILS）のみ変更可。
 *   - 変更は audit_log に旧→新で記録（昔の規格をいつでも参照できる）。
 *   - RULES_CHANGE_NOTIFY on なら Discord / LINE WORKS へ通知。
 */
export async function PUT(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = customerProductRuleUpsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data
  const supabase = createClient()

  // 権限（ロック＋マスター）
  const [lockRaw, masterRaw, notifyRaw] = await Promise.all([
    getSetting('RULES_EDIT_LOCK'),
    getSetting('RULES_MASTER_EMAILS'),
    getSetting('RULES_CHANGE_NOTIFY'),
  ])
  const allowed = canEditRules({
    lock: lockRaw === 'on',
    masterEmails: parseMasterEmails(masterRaw),
    userEmail: user.email,
  })
  if (!allowed) {
    return NextResponse.json(
      { error: 'forbidden', message: '規格はロック中です。変更はマスターに指定された人のみ可能です（設定 → 規格の変更管理）。' },
      { status: 403 },
    )
  }

  // 旧値（監査・差分・新規/更新判定）
  const { data: oldRule, error: oldRuleErr } = await supabase
    .from('customer_product_rules')
    .select('*')
    .eq('customer_id', input.customer_id)
    .eq('product_id', input.product_id)
    .maybeSingle()
  // 旧値は監査差分・新規/更新判定の補助。取得失敗しても upsert は続行。無言にはしない。
  if (oldRuleErr) console.error('[api/customer-product-rules] 旧値の取得に失敗:', oldRuleErr.message)

  const { data: rule, error } = await supabase
    .from('customer_product_rules')
    .upsert(input, { onConflict: 'customer_id,product_id' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 履歴（旧→新）。失敗は握りつぶさない（CLAUDE.md）
  await writeAudit(supabase, {
    entityType: 'customer_product_rules',
    entityId: rule.id,
    action: oldRule ? 'UPDATE' : 'INSERT',
    oldValues: oldRule ?? null,
    newValues: rule,
    userId: user.id,
  })

  // 通知（ベストエフォート。送信失敗でリクエストは失敗させない）
  if (notifyRaw !== 'off') {
    const changes = formatRuleChanges(oldRule ?? null, rule)
    // 実質変化があるときだけ通知
    if (changes.length > 0) {
      try {
        const [{ data: customer }, { data: product }] = await Promise.all([
          supabase.from('customers').select('name').eq('id', input.customer_id).maybeSingle(),
          supabase.from('products').select('name').eq('id', input.product_id).maybeSingle(),
        ])
        const who = user.email ?? '不明'
        const channels = await buildChannelsFromSettings()
        if (channels.length > 0) {
          await notify(
            {
              event: 'rule_changed',
              level: 'info',
              title: `規格${oldRule ? '変更' : '登録'}: ${customer?.name ?? '—'} / ${product?.name ?? '—'}`,
              body: `${summarizeRuleChanges(changes)}（変更者: ${who}）`,
              url: `/admin/customers/${input.customer_id}`,
            },
            channels,
          )
        }
      } catch {
        // 通知失敗は無視（規格保存は成功扱い）
      }
    }
  }

  return NextResponse.json({ rule })
}
