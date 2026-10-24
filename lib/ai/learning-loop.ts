import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateAiRulesCache } from '@/lib/gemini/analyze'

export interface MistakeFeedbackInput {
  clientName: string
  rawInput?: string | null
  correctedField:
    | 'customer'
    | 'destination'
    | 'quantity'
    | 'packs_per_case'
    | 'product'
    | 'spec'
    | 'container'
    | 'general'
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
    let prefixKey = ''
    if (input.correctedField === 'customer' && raw) {
      prefixKey = `【自動学習・取引先判定】伝票表記『${raw}』`
      ruleText = `${prefixKey}は取引先『${input.correctedValue}』として処理。宛名『アイプラス』『小島農園』は当農園(受託側)のため取引先トリガーとしない。`
    } else if (input.correctedField === 'destination') {
      prefixKey = `【自動学習・納入先】取引先『${client}』の納入先・運送『${raw || input.correctedValue}』`
      ruleText = `${prefixKey}は『${input.correctedValue}』に紐付ける。`
    } else if (input.correctedField === 'packs_per_case') {
      prefixKey = `【自動学習・入数】取引先『${client}』`
      ruleText = `${prefixKey}の入数は1箱${input.correctedValue}P（総パック数 ＝ ケース数 × ${input.correctedValue}）。`
    } else if (input.correctedField === 'product' && raw) {
      prefixKey = `【自動学習・品目名寄せ】伝票上の品目表記『${raw}』`
      ruleText = `${prefixKey}は品目『${input.correctedValue}』に正規化する。`
    } else if (input.correctedField === 'spec') {
      prefixKey = `【自動学習・規格設定】取引先『${client}』${input.note ? `（${input.note}）` : ''}`
      ruleText = `${prefixKey}の規格は『${input.correctedValue}』を標準適用する。`
    } else if (input.correctedField === 'container') {
      prefixKey = `【自動学習・コンテナ設定】取引先『${client}』${input.note ? `（${input.note}）` : ''}`
      ruleText = `${prefixKey}のコンテナは『${input.correctedValue}』を標準適用する。`
    } else if (input.correctedField === 'quantity') {
      ruleText = `【自動学習・数量補正】取引先『${client}』: ${raw ? `AI読取『${raw}』ではなく` : ''}『${input.correctedValue}』として処理。`
    } else {
      ruleText = `【自動学習・改善】取引先『${client}』: ${input.note || `${input.correctedField}を『${input.correctedValue}』として処理`}`
    }

    // 同一ルールの重複確認・または同一プレフィックスの自動学習ルール上書き（トークン肥大化防止）
    const { data: existingList } = await admin
      .from('ai_rules')
      .select('id, rule_text, source')
      .eq('client_name', client)

    const exactMatch = (existingList ?? []).find((r) => r.rule_text === ruleText)
    if (exactMatch) {
      return { success: true, ruleId: exactMatch.id, isNew: false }
    }

    const prefixMatch = prefixKey
      ? (existingList ?? []).find((r) => r.source === 'auto_loop' && r.rule_text.startsWith(prefixKey))
      : undefined

    if (prefixMatch) {
      await admin
        .from('ai_rules')
        .update({ rule_text: ruleText, is_active: true })
        .eq('id', prefixMatch.id)
      invalidateAiRulesCache()
      return { success: true, ruleId: prefixMatch.id, isNew: false }
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
