import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { highModelTryOrder } from '@/lib/gemini/models'
import { invalidateAiRulesCache } from '@/lib/gemini/analyze'
import type { AiRule } from '@/types/database'
import { requireAdminApi } from '@/lib/auth/api-guard'
import { runSideEffect, withWarnings } from '@/lib/api/side-effects'

export const runtime = 'nodejs'

export interface RuleConflictItem {
  topic: string
  options: string[]
  recommended: string
}

export interface ConsolidatedClientProposal {
  client_name: string
  original_count: number
  original_texts: string[]
  proposed_rule_text: string
  priority: number
  conflicts: RuleConflictItem[]
}

const CONSOLIDATE_SYSTEM_PROMPT = `あなたは「小島農園」の受発注AIルール最適化・矛盾診断エンジン（Gemini 3.8 Flash）です。
入力された取引先別のAI読取ルール群（初期指示書＋現場の自動学習ルール）を分析し、以下の3つのルールで「1社につき1つの充実した決定版カルテ（高密度・省トークン）」に統合してください。

1. 【重要ロジックの完全保持】:
   FAXの読み取りノウハウ（着日→水曜・金曜出荷への日付変換、1箱あたりの入数換算、手書き修正・丸囲み・矢印の最優先、マトリクス表の納入先別独立抽出、赤字や欄外内訳の抽出、サンプル品の極小数量判定、単価・買値の混同厳禁など）は絶対に削らず100%残すこと。
2. 【矛盾の検出（conflicts）】:
   同一取引先の複数ルール間で「コンテナ種別（例: 青コン vs 緑コン vs 段ボール）」「シール有無（あり vs なし）」「カード有無」「入数」などに食い違いがある場合は、conflicts 配列に検出内容を出力すること。
3. 【超圧縮タグ記法による省トークン化】:
   「【自動学習・コンテナ設定】取引先『◯◯』のコンテナは『◯◯』を標準適用する」のような冗長な文章は削除し、カルテの末尾に \`[標準仕様: 25入 / 緑コン / シール無 / カード無]\` のような超圧縮タグ1つにまとめること。

以下のJSON形式で出力してください（説明文不要）：
{
  "proposals": [
    {
      "client_name": "取引先名",
      "proposed_rule_text": "統合後の決定版カルテ全文（末尾に [標準仕様: ...] タグを含む）",
      "conflicts": [
        {
          "topic": "コンテナ種別の食い違い",
          "options": ["緑コン", "青コン"],
          "recommended": "緑コン"
        }
      ]
    }
  ]
}`

export async function POST(req: Request) {
  const guard = await requireAdminApi('管理者権限が必要です')
  if (!guard.ok) return guard.response
  const admin = createAdminClient()

  const body = (await req.json().catch(() => null)) as {
    action?: 'diagnose' | 'apply'
    proposals?: { client_name: string; proposed_rule_text: string; priority?: number }[]
  } | null

  const action = body?.action ?? 'diagnose'

  const { data: allRulesRaw, error: fetchErr } = await admin
    .from('ai_rules')
    .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const allRules = (allRulesRaw ?? []) as AiRule[]

  // ── 1. 決定版カルテの一括反映（apply） ──
  if (action === 'apply') {
    const items = body?.proposals ?? []
    if (items.length === 0) {
      return NextResponse.json({ error: '反映するルールがありません' }, { status: 400 })
    }

    let updatedCount = 0
    let deletedCount = 0
    /** ルール本体を書けなかった取引先（本体の失敗） */
    const failedClients: string[] = []
    const warnings: string[] = []

    for (const item of items) {
      const client = item.client_name.trim()
      const text = item.proposed_rule_text.trim()
      if (!client || !text) continue

      const clientRules = allRules.filter((r) => r.client_name === client)
      const primary =
        clientRules.find((r) => r.source !== 'auto_loop') ?? clientRules[0]

      if (primary) {
        const { error: updErr } = await admin
          .from('ai_rules')
          .update({
            rule_text: text,
            priority: item.priority ?? primary.priority,
            is_active: true,
            category: 'parsing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', primary.id)
        if (updErr) {
          // 決定版を書けていないのに重複を消すと、その取引先のルールが失われるので消さない
          console.error('[ai-rules/consolidate] 決定版ルールの更新に失敗:', client, updErr.message)
          failedClients.push(client)
          continue
        }
        updatedCount++

        const redundantIds = clientRules
          .filter((r) => r.id !== primary.id)
          .map((r) => r.id)
        if (redundantIds.length > 0) {
          const ok = await runSideEffect(
            warnings,
            `[ai-rules/consolidate] 重複ルールの削除に失敗 (${client})`,
            `「${client}」のルールは更新しましたが、重複していた古いルールを消せませんでした。ルール一覧で確認してください`,
            () => admin.from('ai_rules').delete().in('id', redundantIds),
          )
          if (ok) deletedCount += redundantIds.length
        }
      } else {
        const { error: insErr } = await admin.from('ai_rules').insert({
          client_name: client,
          rule_text: text,
          priority: item.priority ?? 10,
          category: 'parsing',
          source: 'admin_gui',
          is_active: true,
        })
        if (insErr) {
          console.error('[ai-rules/consolidate] 決定版ルールの登録に失敗:', client, insErr.message)
          failedClients.push(client)
          continue
        }
        updatedCount++
      }
    }

    if (updatedCount > 0 || deletedCount > 0) invalidateAiRulesCache()
    if (failedClients.length > 0 && updatedCount === 0) {
      return NextResponse.json(
        { error: `ルールを保存できませんでした（${failedClients.join('、')}）。もう一度お試しください` },
        { status: 500 },
      )
    }
    if (failedClients.length > 0) {
      warnings.push(`次の取引先のルールは保存できませんでした: ${failedClients.join('、')}。もう一度「反映」してください`)
    }
    return NextResponse.json(
      withWarnings(
        {
          success: true,
          updatedCount,
          deletedCount,
        },
        warnings,
      ),
    )
  }

  // ── 2. AI（Gemini 3.8 Flash）による矛盾診断＆決定版カルテ生成（diagnose） ──
  const grouped = new Map<string, AiRule[]>()
  for (const r of allRules) {
    if (!r.is_active) continue
    const list = grouped.get(r.client_name) ?? []
    list.push(r)
    grouped.set(r.client_name, list)
  }

  const inputSummary = Array.from(grouped.entries()).map(([client_name, list]) => ({
    client_name,
    priority: Math.min(...list.map((r) => r.priority)),
    rules: list.map((r) => ({
      source: r.source,
      text: r.rule_text,
      created_at: r.created_at,
    })),
  }))

  const apiKey = await getSetting('GEMINI_API_KEY')
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY が未設定です' }, { status: 500 })
  }

  const preferredHigh = await getSetting('GEMINI_MODEL_HIGH')
  const order = highModelTryOrder(preferredHigh)
  const genAI = new GoogleGenerativeAI(apiKey)

  let aiProposals: {
    client_name: string
    proposed_rule_text: string
    conflicts?: RuleConflictItem[]
  }[] = []
  let usedModel = order[0] ?? 'gemini-3.8-flash'

  for (const modelName of order) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: CONSOLIDATE_SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.0,
          responseMimeType: 'application/json',
        },
      })
      const res = await model.generateContent([
        { text: JSON.stringify(inputSummary) },
      ])
      const parsed = JSON.parse(res.response.text()) as {
        proposals?: {
          client_name: string
          proposed_rule_text: string
          conflicts?: RuleConflictItem[]
        }[]
      }
      if (Array.isArray(parsed.proposals)) {
        aiProposals = parsed.proposals
        usedModel = modelName
        break
      }
    } catch (e) {
      console.warn(`[ai-rules/consolidate] model ${modelName} failed:`, e)
    }
  }

  const proposals: ConsolidatedClientProposal[] = Array.from(grouped.entries()).map(
    ([client_name, list]) => {
      const found = aiProposals.find((p) => p.client_name === client_name)
      const fallbackMerged = list.map((r) => r.rule_text.trim()).join(' ')
      return {
        client_name,
        original_count: list.length,
        original_texts: list.map((r) => r.rule_text),
        proposed_rule_text: found?.proposed_rule_text || fallbackMerged,
        priority: Math.min(...list.map((r) => r.priority)),
        conflicts: found?.conflicts ?? [],
      }
    },
  )

  const beforeChars = allRules
    .filter((r) => r.is_active)
    .reduce((acc, r) => acc + r.rule_text.length, 0)
  const afterChars = proposals.reduce((acc, p) => acc + p.proposed_rule_text.length, 0)

  return NextResponse.json({
    usedModel,
    beforeRuleCount: allRules.filter((r) => r.is_active).length,
    afterRuleCount: proposals.length,
    beforeChars,
    afterChars,
    proposals,
  })
}
