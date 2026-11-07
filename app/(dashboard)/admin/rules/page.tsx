import { BrainCircuit } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getSetting } from '@/lib/settings'
import { resolveToggle } from '@/lib/settings-spec'
import { DEFAULT_HIGH_GEMINI_MODEL, DEFAULT_MAIN_GEMINI_MODEL } from '@/lib/gemini/models'
import { ErrorState } from '@/components/ui/States'
import { AiRulesManager } from '@/components/admin/AiRulesManager'
import { ApprovalPipelineToggle } from '@/components/admin/ApprovalPipelineToggle'
import type { AiRule } from '@/types/database'

export const dynamic = 'force-dynamic'

/**
 * AI学習ルール画面（/admin/rules）。
 * - 自動確定のオン／オフと基準（オンにするときは確認あり）
 * - 取引先ごとの読み取りルールの一覧・追加・編集・削除、試し読み
 * - 読み取りに使うAIの選択（詳細設定に畳む）
 */
export default async function AdminAiRulesPage() {
  const guard = await requireAdmin('AIルール管理は管理者のみです。')
  if (guard) return guard

  const supabase = createAdminClient()

  const [rulesRes, custsRes, currentMainModel, currentHighModel, autoApproveRaw, thresholdRaw] =
    await Promise.all([
      supabase
        .from('ai_rules')
        .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('customers')
        .select('id, name')
        .eq('is_active', true)
        .order('name'),
      getSetting('GEMINI_MODEL'),
      getSetting('GEMINI_MODEL_HIGH'),
      getSetting('AUTO_APPROVE_ENABLED'),
      getSetting('AUTO_APPROVE_THRESHOLD'),
    ])

  if (rulesRes.error) {
    return (
      <ErrorState
        message="AI学習ルールを読み込めませんでした。時間をおいて再度お試しください。続く場合は開発担当にお知らせください。"
        detail={rulesRes.error.message}
      />
    )
  }

  const rules = (rulesRes.data ?? []) as AiRule[]
  const customers = (custsRes.data ?? []) as { id: string; name: string }[]

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-earth-700" aria-hidden />
            <h1 className="font-display text-2xl font-bold text-ink">AI学習ルール</h1>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            取引先ごとのFAX・メールの読み取りルールと、自動確定の設定を管理します。保存した内容はすぐに反映されます。
          </p>
        </div>
      </div>

      {/* 管理者専用：承認パイプラインのON/OFF（手動確認 ⇔ 自動確定モード）ワンクリック切替 */}
      <ApprovalPipelineToggle
        // 未設定のときの実際の動作（取り込み処理は未設定＝オン）に表示をそろえる
        initialAutoApprove={resolveToggle(autoApproveRaw, 'on') === 'on'}
        initialThreshold={thresholdRaw?.trim() || '0.80'}
      />

      <AiRulesManager
        initialRules={rules}
        customers={customers}
        initialModel={currentMainModel ?? DEFAULT_MAIN_GEMINI_MODEL}
        initialHighModel={currentHighModel ?? DEFAULT_HIGH_GEMINI_MODEL}
      />
    </div>
  )
}
