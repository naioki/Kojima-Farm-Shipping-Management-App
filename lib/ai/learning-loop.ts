import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateAiRulesCache } from '@/lib/gemini/analyze'

export interface MistakeFeedbackInput {
  clientName: string
  rawInput?: string | null
  correctedField: 'customer' | 'destination' | 'quantity' | 'packs_per_case' | 'product' | 'general'
  correctedValue: string
  originalAiValue?: string | null
  note?: string | null
}

/**
 * 誤読・現場修正・不一致（ミス）を検知し、`ai_rules` テーブルへ自動蓄積する。
 * キャッシュ破棄（invalidateAiRulesCache）を行い、次回以降のGemini解析プロンプトへ即座に注入される閉ループを形成する。
 * 管理画面（/admin/rules）でいつでも参照・修正（直す）・ON/OFF切り替えが可能。
 */
export async function recordMistakeFeedback(
  input: MistakeFeedbackInput,
): Promise<{ success: boolean; ruleId?: string; isNew?: boolean }> {
  try {
    const admin = createAdminClient()
    const client = input.clientName?.trim() || '共通'
    const raw = input.rawInput?.trim() || input.originalAiValue?.trim() || ''

    // 意味のある修正でない場合はスキップ
    if (!input.correctedValue?.trim()) return { success: false }
    if (raw && raw === input.correctedValue.trim()) return { success: false }

    // ルール文の自動合成（省トークン・高精度ルール形式）
    let ruleText = ''
    if (input.correctedField === 'customer' && raw) {
      ruleText = `【自動学習・取引先判定】伝票表記『${raw}』は取引先『${input.correctedValue}』として処理。宛名『アイプラス』『小島農園』は当農園(受託側)のため取引先トリガーとしない。`
    } else if (input.correctedField === 'destination') {
      ruleText = `【自動学習・納入先】取引先『${client}』の納入先・運送『${raw || input.correctedValue}』は『${input.correctedValue}』に紐付ける。`
    } else if (input.correctedField === 'packs_per_case') {
      ruleText = `【自動学習・入数】取引先『${client}』の入数は1箱${input.correctedValue}P（総パック数 ＝ ケース数 × ${input.correctedValue}）。`
    } else if (input.correctedField === 'product' && raw) {
      ruleText = `【自動学習・品目名寄せ】伝票上の品目表記『${raw}』は品目『${input.correctedValue}』に正規化する。`
    } else if (input.correctedField === 'quantity') {
      ruleText = `【自動学習・数量補正】取引先『${client}』: ${raw ? `AI読取『${raw}』ではなく` : ''}『${input.correctedValue}』として処理。`
    } else {
      ruleText = `【自動学習・改善】取引先『${client}』: ${input.note || `${input.correctedField}を『${input.correctedValue}』として処理`}`
    }

    // 同一ルールの重複確認
    const { data: existing } = await admin
      .from('ai_rules')
      .select('id, rule_text')
      .eq('client_name', client)
      .eq('rule_text', ruleText)
      .maybeSingle()

    if (existing) {
      return { success: true, ruleId: existing.id, isNew: false }
    }

    const { data: inserted, error } = await admin
      .from('ai_rules')
      .insert({
        client_name: client,
        rule_text: ruleText,
        priority: 15,
        category: 'mistake_correction',
        source: 'auto_loop',
        is_active: true,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[learning-loop] ai_rules への蓄積に失敗:', error.message)
      return { success: false }
    }

    // キャッシュを即座に破棄して次回AI読取に即時反映
    invalidateAiRulesCache()
    return { success: true, ruleId: inserted?.id, isNew: true }
  } catch (err) {
    console.error('[learning-loop] 例外:', err)
    return { success: false }
  }
}
