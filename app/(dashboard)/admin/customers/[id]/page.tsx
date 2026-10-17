import Link from 'next/link'
import { ChevronLeft, Lock } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { CustomerRulesEditor, type RuleRow } from '@/components/admin/CustomerRulesEditor'
import { CustomerManage } from '@/components/admin/CustomerManage'
import { RulesHistory, type RuleHistoryEntry } from '@/components/admin/RulesHistory'
import { CustomerColorPicker } from '@/components/admin/CustomerColorPicker'
import { DestinationManager, type Destination } from '@/components/admin/DestinationManager'
import { getSetting } from '@/lib/settings'
import { canEditRules, parseMasterEmails } from '@/lib/rules/permission'
import { formatRuleChanges } from '@/lib/rules/format'
import type { FractionPolicy } from '@/types/database'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 取引先 詳細（Laravel版 画面5）。
 * 品目ごとの P/C・荷姿・「いつものセット」・端数ポリシーを編集する。
 * 規格はロック中ならマスターのみ変更可。変更は履歴（audit_log）に残り参照できる。
 */
export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const guard = await requireAdmin('取引先設定は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()
  const user = await getAuthedUser()

  const [
    { data: customer, error: custErr },
    { data: products, error: prodErr },
    { data: rules, error: rulesErr },
    { data: auditRows, error: auditErr },
    { data: destinations, error: destErr },
    lockRaw,
    masterRaw,
  ] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, name_kana, payment_terms, is_active, display_color')
      .eq('id', params.id)
      .maybeSingle(),
    supabase.from('products').select('id, name, unit').eq('is_active', true).order('name'),
    supabase
      .from('customer_product_rules')
      .select('product_id, packs_per_case, container_type, spec, has_card, is_default_set, default_quantity, fraction_policy, label_spec, tape_color, packing_notes')
      .eq('customer_id', params.id),
    supabase
      .from('audit_log')
      .select('action, old_values, new_values, user_id, created_at')
      .eq('entity_type', 'customer_product_rules')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('delivery_destinations')
      .select('id, code, full_name, aliases, is_active')
      .eq('customer_id', params.id)
      .order('sort_order')
      .order('full_name'),
    getSetting('RULES_EDIT_LOCK'),
    getSetting('RULES_MASTER_EMAILS'),
  ])
  // 取引ルール・納入先は編集の主データ。取得失敗を「未登録（空）」に化けさせない
  // （荷姿マスタが空に見えた実害と同種の事故を防ぐ・CLAUDE.md）。
  const detailErr = custErr ?? prodErr ?? rulesErr ?? destErr
  if (detailErr) {
    return (
      <ErrorState
        message="取引先の情報を読み込めませんでした。時間をおいて再度お試しください。"
        detail={detailErr.message}
      />
    )
  }
  if (!customer) return <ErrorState title="取引先が見つかりません" message="削除されたか、IDが不正の可能性があります。" />
  // 変更履歴は補助表示。失敗しても本体は殺さず、履歴だけ空で続行する。
  if (auditErr) console.error('[customers/[id]] 規格変更履歴の取得に失敗:', auditErr.message)

  const lock = lockRaw === 'on'
  const canEdit = canEditRules({ lock, masterEmails: parseMasterEmails(masterRaw), userEmail: user?.email })

  const initialRules: Record<string, RuleRow> = {}
  for (const r of rules ?? []) {
    initialRules[r.product_id] = {
      packs_per_case: r.packs_per_case,
      container_type: r.container_type,
      spec: r.spec,
      has_card: r.has_card,
      is_default_set: r.is_default_set,
      default_quantity: r.default_quantity,
      fraction_policy: r.fraction_policy as FractionPolicy,
      label_spec: r.label_spec,
      tape_color: r.tape_color,
      packing_notes: r.packing_notes,
    }
  }
  const productName = new Map((products ?? []).map((p) => [p.id, p.name]))

  // この取引先の規格変更履歴（audit_log を customer_id でJSフィルタ→整形）
  type Vals = Record<string, unknown> | null
  const relevant = (auditRows ?? []).filter((a) => {
    const nv = a.new_values as Vals
    const ov = a.old_values as Vals
    return nv?.customer_id === params.id || ov?.customer_id === params.id
  })
  const editorIds = [...new Set(relevant.map((a) => a.user_id).filter(Boolean))] as string[]
  const { data: editors, error: editorsErr } = editorIds.length
    ? await supabase.from('users').select('id, email, full_name').in('id', editorIds)
    : { data: [] as { id: string; email: string | null; full_name: string | null }[], error: null }
  // 履歴の編集者名の解決（補助）。失敗しても履歴は「不明」で表示し本体は殺さない。
  if (editorsErr) console.error('[customers/[id]] 編集者名の解決に失敗:', editorsErr.message)
  const editorById = new Map((editors ?? []).map((u) => [u.id, u.full_name || u.email || '不明']))

  const history: RuleHistoryEntry[] = relevant.slice(0, 30).map((a) => {
    const nv = a.new_values as Vals
    const ov = a.old_values as Vals
    const pid = String((nv?.product_id ?? ov?.product_id) ?? '')
    return {
      at: a.created_at,
      productName: productName.get(pid) ?? '（削除された品目）',
      who: a.user_id ? editorById.get(a.user_id) ?? '不明' : '不明',
      isNew: a.action === 'INSERT',
      changes: formatRuleChanges(ov, nv),
    }
  })

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        取引先一覧
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold text-ink">
          {customer.name}
          {!customer.is_active && <span className="ml-2 align-middle text-sm font-normal text-ink-faint">（停止中）</span>}
        </h1>
        {customer.name_kana && <p className="text-sm text-ink-faint">{customer.name_kana}</p>}
      </div>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">取引先情報・操作</h2>
        <CustomerManage
          customer={{
            id: customer.id,
            name: customer.name,
            name_kana: customer.name_kana,
            payment_terms: customer.payment_terms,
            is_active: customer.is_active,
          }}
        />
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">識別色</h2>
          <p className="text-sm text-ink-soft">出荷一覧・注文入力でこの取引先を色で瞬時に識別できます。</p>
        </div>
        <CustomerColorPicker
          customerId={customer.id}
          customerName={customer.name}
          initialColor={customer.display_color}
        />
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">納入先（届け先）</h2>
          <p className="text-sm text-ink-soft">
            この取引先に複数の届け先がある場合に登録します（例: 仲卸の各店舗）。表示は常に
            「<strong className="text-ink">{customer.name} ＞ 納入先</strong>」。略称は普段の表示、正式名は伝票、表記ゆれはOCRの名寄せに使います。
          </p>
        </div>
        <DestinationManager
          customerId={customer.id}
          customerName={customer.name}
          initial={(destinations ?? []) as Destination[]}
        />
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">取引ルール（品目別・規格）</h2>
          <p className="text-sm text-ink-soft">
            P/C はケース記法（例 <span className="num">15c2</span>）の換算基準。「いつものセット」はポータルの初期表示に使われます。
          </p>
        </div>
        {lock && !canEdit && (
          <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-ink-soft">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              規格はロック中です。変更は<strong className="text-ink">マスターに指定された人のみ</strong>可能です（閲覧はできます）。
              担当の変更は設定 →「規格（取引ルール）の変更管理」で調整します。
            </span>
          </div>
        )}
        {!products?.length ? (
          <EmptyState title="商品がありません" description="商品マスタを登録すると編集できます。" />
        ) : (
          <CustomerRulesEditor
            customerId={customer.id}
            products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
            initialRules={initialRules}
            canEdit={canEdit}
          />
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">規格の変更履歴</h2>
        <RulesHistory entries={history} />
      </Card>
    </div>
  )
}
