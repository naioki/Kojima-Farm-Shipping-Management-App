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
    | 'has_card'
    | 'has_seal'
    | 'bag_type'
    | 'general'
  correctedValue: string
  originalAiValue?: string | null
  note?: string | null
}

/**
 * 1社1枠の決定版カルテ末尾にある `[標準仕様: ...]` タグを解析・更新するヘルパー。
 * 冗長な日本語文を何行も追加せず、高密度タグ（約15〜30文字）内で該当属性だけを上書きし、
 * 本文中の古い容器・入数・シール記述の矛盾も同時に解消する。
 */
export function mergeSpecTagIntoRuleText(
  existingText: string,
  field: MistakeFeedbackInput['correctedField'],
  rawVal: string,
): string {
  const val = rawVal.trim()
  let text = existingText.trim()

  // 1. 本文中の明らかな旧記述があれば同時に置換してカルテ内矛盾をゼロにする
  if (field === 'container') {
    text = text.replace(/容器は『[^』]+』/g, `容器は『${val}』`)
    text = text.replace(/コンテナは『[^』]+』/g, `コンテナは『${val}』`)
  } else if (field === 'packs_per_case') {
    const num = val.replace(/[^0-9]/g, '')
    if (num) {
      text = text.replace(/packs_per_case\s*:\s*\d+/g, `packs_per_case:${num}`)
    }
  } else if (field === 'has_seal') {
    const isSealOn = val.includes('あり') || val === 'true'
    text = text.replace(/has_seal\s*:\s*(?:true|false)/g, `has_seal:${isSealOn ? 'true' : 'false'}`)
  } else if (field === 'has_card') {
    const isCardOn = val.includes('あり') || val.includes('有') || val === 'true'
    text = text.replace(/has_card\s*:\s*(?:true|false)/g, `has_card:${isCardOn ? 'true' : 'false'}`)
  }

  // 2. `[標準仕様: ...]` タグの抽出と更新
  const tagRegex = /\[標準仕様:\s*([^\]]+)\]/
  const match = text.match(tagRegex)
  const items = new Map<string, string>()

  if (match && match[1]) {
    const parts = match[1].split('/').map((s) => s.trim()).filter(Boolean)
    for (const p of parts) {
      if (p.endsWith('入') || p.startsWith('入数')) items.set('packs_per_case', p)
      else if (p.includes('コン') || p.includes('段ボール') || p.includes('オリコン') || p.startsWith('容器:')) items.set('container', p)
      else if (p.includes('シール')) items.set('has_seal', p)
      else if (p.includes('カード')) items.set('has_card', p)
      else if (p.includes('袋')) items.set('bag_type', p)
      else if (p.startsWith('規格:')) items.set('spec', p)
      else items.set(p, p)
    }
  }

  if (field === 'packs_per_case') {
    const num = val.replace(/[^0-9]/g, '') || val
    items.set('packs_per_case', `${num}入`)
  } else if (field === 'container') {
    items.set('container', val)
  } else if (field === 'has_seal') {
    const isSealOn = val.includes('あり') || val === 'true'
    items.set('has_seal', isSealOn ? 'シール有' : 'シール無')
  } else if (field === 'has_card') {
    const isCardOn = val.includes('あり') || val.includes('有') || val === 'true'
    items.set('has_card', isCardOn ? 'カード有' : 'カード無')
  } else if (field === 'bag_type') {
    items.set('bag_type', val)
  } else if (field === 'spec') {
    items.set('spec', `規格:${val}`)
  }

  const orderedKeys = ['packs_per_case', 'container', 'bag_type', 'has_seal', 'has_card', 'spec']
  const tagParts: string[] = []
  for (const k of orderedKeys) {
    if (items.has(k)) {
      tagParts.push(items.get(k)!)
      items.delete(k)
    }
  }
  for (const v of items.values()) {
    tagParts.push(v)
  }

  const newTag = `[標準仕様: ${tagParts.join(' / ')}]`
  if (tagRegex.test(text)) {
    return text.replace(tagRegex, newTag)
  }
  return text ? `${text} ${newTag}` : newTag
}

/**
 * 誤読・現場修正・不一致（ミス）を検知し、`ai_rules` テーブルの「1社1枠の決定版カルテ」へ自動統合する。
 * - 行を無制限に増やさず、既存カルテ内の `[標準仕様: ...]` タグおよび本文をインライン更新して矛盾・トークン肥大化を防止。
 * - キャッシュ破棄（invalidateAiRulesCache）を行い、次回以降のGemini解析プロンプトへ即座に注入される閉ループを形成する。
 */
export async function recordMistakeFeedback(
  input: MistakeFeedbackInput,
): Promise<{ success: boolean; ruleId?: string; isNew?: boolean }> {
  try {
    const admin = createAdminClient()
    const client = input.clientName?.trim() || '共通'
    const raw = input.rawInput?.trim() || input.originalAiValue?.trim() || ''

    if (!input.correctedValue?.trim()) return { success: false }
    if (raw && raw === input.correctedValue.trim()) return { success: false }

    const isSpecAttribute = [
      'packs_per_case',
      'spec',
      'container',
      'has_card',
      'has_seal',
      'bag_type',
    ].includes(input.correctedField)

    const { data: existingList } = await admin
      .from('ai_rules')
      .select('id, rule_text, source, priority, created_at')
      .eq('client_name', client)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    const rules = existingList ?? []

    // 1. 資材・コンテナ・入数・シール・カード等の標準仕様変更は、1社1枠の決定版カルテに超圧縮タグで統合更新
    if (isSpecAttribute && client !== '共通') {
      const primaryRule =
        rules.find((r) => r.source !== 'auto_loop') ?? rules[0]

      if (primaryRule) {
        const mergedText = mergeSpecTagIntoRuleText(
          primaryRule.rule_text,
          input.correctedField,
          input.correctedValue,
        )
        await admin
          .from('ai_rules')
          .update({
            rule_text: mergedText,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', primaryRule.id)

        // もし過去に散乱した auto_loop の別行が残っていれば自動クリーンアップ
        const redundantAutoIds = rules
          .filter((r) => r.id !== primaryRule.id && r.source === 'auto_loop')
          .map((r) => r.id)
        if (redundantAutoIds.length > 0) {
          await admin.from('ai_rules').delete().in('id', redundantAutoIds)
        }

        invalidateAiRulesCache()
        return { success: true, ruleId: primaryRule.id, isNew: false }
      }

      // まだ1枠も無い新規取引先の場合は、コンパクトな1枠目を新規作成
      const initialText = mergeSpecTagIntoRuleText(
        `[${client}] 取引先『${client}』。`,
        input.correctedField,
        input.correctedValue,
      )
      const { data: inserted, error } = await admin
        .from('ai_rules')
        .insert({
          client_name: client,
          rule_text: initialText,
          priority: 10,
          category: 'parsing',
          source: 'auto_loop',
          is_active: true,
        })
        .select('id')
        .single()
      if (error) return { success: false }
      invalidateAiRulesCache()
      return { success: true, ruleId: inserted?.id, isNew: true }
    }

    // 2. 取引先名・納入先名・品目名寄せ等の学習
    let compactAddon = ''
    if (input.correctedField === 'customer' && raw) {
      compactAddon = `伝票表記『${raw}』→取引先『${input.correctedValue}』（アイプラス・小島農園は受託側のため除外）。`
    } else if (input.correctedField === 'destination') {
      compactAddon = `納入先表記『${raw || input.correctedValue}』→『${input.correctedValue}』。`
    } else if (input.correctedField === 'product' && raw) {
      compactAddon = `品目表記『${raw}』→『${input.correctedValue}』。`
    } else if (input.correctedField === 'quantity') {
      compactAddon = `数量注意:${raw ? `『${raw}』ではなく` : ''}『${input.correctedValue}』。`
    } else {
      compactAddon = `${input.note || `${input.correctedField}→『${input.correctedValue}』`}。`
    }

    const primaryRule = rules.find((r) => r.source !== 'auto_loop') ?? rules[0]
    if (primaryRule) {
      if (primaryRule.rule_text.includes(compactAddon)) {
        return { success: true, ruleId: primaryRule.id, isNew: false }
      }
      const nextText = `${primaryRule.rule_text.trim()} ${compactAddon}`
      await admin
        .from('ai_rules')
        .update({
          rule_text: nextText,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', primaryRule.id)
      invalidateAiRulesCache()
      return { success: true, ruleId: primaryRule.id, isNew: false }
    }

    const { data: inserted, error } = await admin
      .from('ai_rules')
      .insert({
        client_name: client,
        rule_text: compactAddon,
        priority: 10,
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

    invalidateAiRulesCache()
    return { success: true, ruleId: inserted?.id, isNew: true }
  } catch (err) {
    console.error('[learning-loop] 例外:', err)
    return { success: false }
  }
}
