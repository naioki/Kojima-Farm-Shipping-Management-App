import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getSetting } from '@/lib/settings'
import { ErrorState } from '@/components/ui/States'
import { AiRulesManager } from '@/components/admin/AiRulesManager'
import type { AiRule } from '@/types/database'

export const dynamic = 'force-dynamic'

/**
 * AIルール・ナレッジ管理画面（/admin/rules）。
 * - 取引先別（和郷園・房総食料センター・勘兵衛・NSK・共通）の読取ルール一覧表示、ON/OFFトグル切り替え、追加・編集・削除
 * - 使用AIモデル（GEMINI_MODEL）の自由入力指定（新モデル登場時にコード変更不要で即時反映）
 * - ルール・モデルのドライラン動作テスト機能
 */
export default async function AdminAiRulesPage() {
  const guard = await requireAdmin('AIルール管理は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()

  const [rulesRes, custsRes, currentModel] = await Promise.all([
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
            取引先ごとのFAX読取・入数換算ルール（20入/24入・マテハン名寄せ・注文外スキップ）と使用AIモデルを管理します。変更は再デプロイ不要で即座にAI解析へ反映されます。
          </p>
        </div>
      </div>

      <AiRulesManager
        initialRules={rules}
        customers={customers}
        initialModel={currentModel ?? ''}
      />
    </div>
  )
}
