import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getSetting } from '@/lib/settings'
import { isAutoApproveOn } from '@/lib/ingestion/auto-approve'
import { DEFAULT_HIGH_GEMINI_MODEL, DEFAULT_MAIN_GEMINI_MODEL } from '@/lib/gemini/models'
import { ErrorState } from '@/components/ui/States'
import { AiRulesManager } from '@/components/admin/AiRulesManager'
import { ApprovalPipelineToggle } from '@/components/admin/ApprovalPipelineToggle'
import type { AiRule } from '@/types/database'

export const dynamic = 'force-dynamic'

/**
 * AIルール・ナレッジ管理画面（/admin/rules）。
 * - 承認パイプラインのON/OFF（手動承認 ⇔ 自動確定モード）ワンクリック切り替え
 * - 2段階AIモデル（メインモデル `gemini-3.5-flash-lite` ＆ 重要箇所モデル `gemini-3.8-flash`）の自由入力指定
 * - 取引先別（和郷園・房総食料センター・勘兵衛・NSK・共通）の読取ルール一覧表示、ON/OFFトグル切り替え、追加・編集・削除
 * - ルール・モデルのドライラン動作テスト機能
 */
export default async function AdminAiRulesPage() {
  const guard = await requireAdmin('AIルール管理は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()

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
        message="AI学習ルールを読み込めませんでした。マイグレーション（0025_ai_rules.sql）が適用されているか確認してください。"
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
            <Sparkles className="h-6 w-6 text-earth-700" aria-hidden />
            <h1 className="font-display text-2xl font-bold text-ink">AI学習ルール・モデル管理（チンゲン菜 v2.3）</h1>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            メインモデル（<code className="font-mono">gemini-3.5-flash-lite</code>）と重要箇所モデル（<code className="font-mono">gemini-3.8-flash</code>）の自由入力切替、承認パイプラインの自動化ON/OFF、取引先別読取ルールを管理します。変更は再デプロイ不要で即座に反映されます。
          </p>
        </div>
      </div>

      {/* 管理者専用：承認パイプラインのON/OFF（手動確認 ⇔ 自動確定モード）ワンクリック切替 */}
      <ApprovalPipelineToggle
        initialAutoApprove={isAutoApproveOn(autoApproveRaw)}
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
