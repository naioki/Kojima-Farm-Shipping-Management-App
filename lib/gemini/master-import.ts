import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'

/**
 * 写真からマスタ一括取込（OCR）の Gemini 解析。
 *
 * 受注明細OCR（lib/gemini/analyze.ts・SDK）とは独立。こちらは紙の台帳・取引先一覧・
 * 規格表を撮影した画像から、3種のマスタを一括抽出する専用モジュール:
 *   - 店舗・取引先 (customers)
 *   - 品目＝野菜の名前 (products)
 *   - 規格・荷姿 (pack_configs)：どの品目に属するかも含む
 *
 * 設計:
 *   - SDK を使わず generateContent を直接 fetch（responseMimeType=application/json + responseSchema）。
 *   - temperature: 0（推測を避け、読めたまま正確に）。
 *   - モデルは新→古の順でフォールバック（429/503/404 のときだけ次へ。それ以外は即 throw）。
 *   - API キーは Secret Manager 由来（getSetting: DB→env）。'server-only' で client から遮断。
 */

/** 新→古の順。429/503/404 のときのみ次のモデルへフォールバックする。 */
export const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
] as const

// ============================================================
// 抽出結果スキーマ（responseSchema と一対一）
// ============================================================
export const masterProductSchema = z.object({
  name: z.string(),
  name_kana: z.string().nullish(),
  base_unit: z.string().nullish(),
  tax_rate: z.union([z.literal(8), z.literal(10)]).nullish(),
  confidence: z.number().min(0).max(1),
})
export type MasterProduct = z.infer<typeof masterProductSchema>

export const masterStandardSchema = z.object({
  /** どの品目の規格か（品目名で表現。確定は確認画面で名寄せ／無ければ自動作成）。 */
  product_name: z.string(),
  /** 表示名「スタンドパック3個入り12袋」「Lサイズ 5kg箱」等。 */
  label: z.string(),
  /** 注文・価格の単位名「ケース」「箱」「袋」。 */
  selling_unit_label: z.string().nullish(),
  /** 販売単位1あたりの基準単位数（換算の橋）。読めなければ null。 */
  base_per_selling: z.number().positive().nullish(),
  confidence: z.number().min(0).max(1),
})
export type MasterStandard = z.infer<typeof masterStandardSchema>

export const masterCustomerSchema = z.object({
  name: z.string(),
  name_kana: z.string().nullish(),
  confidence: z.number().min(0).max(1),
})
export type MasterCustomer = z.infer<typeof masterCustomerSchema>

export const masterUncategorizedSchema = z.object({
  text: z.string(),
  reason: z.string().nullish(),
})
export type MasterUncategorized = z.infer<typeof masterUncategorizedSchema>

export const masterResultSchema = z.object({
  products: z.array(masterProductSchema).default([]),
  standards: z.array(masterStandardSchema).default([]),
  customers: z.array(masterCustomerSchema).default([]),
  uncategorized: z.array(masterUncategorizedSchema).default([]),
})
export type MasterResult = z.infer<typeof masterResultSchema>

/** 既存マスタ（名寄せの基準としてプロンプトに注入する）。 */
export interface ExistingMasters {
  customers: string[]
  products: string[]
  /** 品目名 → その品目の既存規格名（荷姿ラベル）一覧。 */
  standardsByProduct: Record<string, string[]>
}

export interface MasterImage {
  /** data URL の接頭辞を除いた base64。 */
  base64: string
  mimeType: string
}

// ============================================================
// responseSchema（Gemini 構造化出力・OpenAPI サブセット）
// ============================================================
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          name_kana: { type: 'string' },
          base_unit: { type: 'string' },
          tax_rate: { type: 'integer' },
          confidence: { type: 'number' },
        },
        required: ['name', 'confidence'],
      },
    },
    standards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product_name: { type: 'string' },
          label: { type: 'string' },
          selling_unit_label: { type: 'string' },
          base_per_selling: { type: 'number' },
          confidence: { type: 'number' },
        },
        required: ['product_name', 'label', 'confidence'],
      },
    },
    customers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          name_kana: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['name', 'confidence'],
      },
    },
    uncategorized: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['text'],
      },
    },
  },
  required: ['products', 'standards', 'customers', 'uncategorized'],
} as const

// ============================================================
// プロンプト
// ============================================================
function buildPrompt(existing: ExistingMasters): string {
  const fmtList = (xs: string[]) => (xs.length ? xs.join(' / ') : '（登録なし）')
  const standardsLines = Object.entries(existing.standardsByProduct)
    .filter(([, labels]) => labels.length > 0)
    .map(([p, labels]) => `  - ${p}: ${labels.join(' / ')}`)
    .join('\n')

  return `あなたは日本の農産物出荷業者の紙資料（取引先一覧・品目台帳・規格表・荷姿メモ）を読み取り、
業務マスタとして構造化する専門家です。受発注ミスは農園の信用に直結します。
気を利かせて整えるより「読めたまま正確に写す」ことを常に最優先してください。

# あなたのタスク
与えられた画像（複数枚）から、次の3種類のマスタ情報を**漏れなく**抽出して JSON で返す。
1. customers … 店舗・取引先（出荷先・販売先の会社/店舗名）
2. products … 品目（野菜そのものの名前。例「トマト」「小松菜」「きゅうり」）
3. standards … 規格・荷姿（どの品目の、どんな荷姿/サイズ/入数か）

# 既存マスタ（名寄せの基準・この表記にそろえる）
既存の取引先: ${fmtList(existing.customers)}
既存の品目: ${fmtList(existing.products)}
既存の品目ごとの規格:
${standardsLines || '  （登録なし）'}

# 絶対ルール
- 1枚の紙に複数の会社・品目・規格が混在していても、すべて漏れなく抽出する。
- **推測で埋めない**。読めない・自信がない項目は confidence を 0.5 未満にする。空欄でよい項目は無理に埋めない。
- 既存マスタに同じ/似た表記があれば、その表記に正規化してそろえる（全角半角・ひらがな/カタカナ・送り仮名の統一）。
- 同一のものは1件にまとめる（重複出力しない）。
- 3カテゴリ（取引先/品目/規格）のどれにも当てはまらない情報（中間業者・運送会社・電話番号・住所・日付・担当者名・金額など）は uncategorized に入れる。マスタ本体には混ぜない。

# 各カテゴリの規則
## products（品目）
- name: 野菜の標準的な名前のみ（サイズ・規格・入数・括弧書きは含めない）。例: 規格表に「トマトL 4kg箱」とあっても品目は「トマト」。
- name_kana: 読み仮名が読み取れれば（任意）。
- base_unit: 基準単位（個・本・束・袋・kg 等）。在庫・収穫を数える最小単位。読めなければ省略（既定は「個」）。
- tax_rate: 農産物は 8、資材・送料等は 10。判断できなければ省略。
- confidence: その品目を正しく読めた自信(0..1)。

## standards（規格・荷姿）
- product_name: その規格が属する品目名（必須）。上の products の name と一致させる。
- label: 規格・荷姿の表示名。サイズ・入数・容器を含めてそのまま写す。例「Lサイズ 4kg箱」「3個入りスタンドパック 12袋ケース」「2L 10kg」。
- selling_unit_label: 注文・価格をつける単位名（箱・ケース・袋・コンテナ等）。読めなければ省略。
- base_per_selling: 販売単位1つ＝基準単位いくつ分か（例「1ケース＝12袋×3個＝36個」なら 36、「1箱＝20個」なら 20）。
    計算根拠が紙に明記されている場合のみ数値化する。読み取れない・曖昧なら**省略**し confidence を下げる（勝手に計算しない）。
- confidence: 0..1。

## customers（取引先）
- name: 会社名・店舗名（必須）。「(株)」「有限会社」等の法人格は読めたまま含める。
- name_kana: 読み仮名（任意）。
- confidence: 0..1。

# 出力形式（厳守）
次の構造の JSON だけを返す。前置き・説明・コードフェンスは一切付けない。
{
  "products":      [ { "name", "name_kana?", "base_unit?", "tax_rate?", "confidence" } ],
  "standards":     [ { "product_name", "label", "selling_unit_label?", "base_per_selling?", "confidence" } ],
  "customers":     [ { "name", "name_kana?", "confidence" } ],
  "uncategorized": [ { "text", "reason?" } ]
}

迷ったときの原則：「正しく写す」＞「気を利かせて整える」。`
}

// ============================================================
// 呼び出し
// ============================================================
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** フォールバックして良いステータス（過負荷・存在しないモデル）。 */
const FALLBACK_STATUS = new Set([429, 503, 404])

async function logUsage(success: boolean) {
  try {
    await createAdminClient()
      .from('gemini_usage_log')
      .insert({ mode: 'master_import', channel: 'manual', success })
  } catch {
    // 記録失敗で本処理は止めない（無料枠管理は best-effort）
  }
}

/** ```json フェンスや前後ノイズを取り除いて JSON テキストを取り出す。 */
function stripToJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1]! : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Gemini 応答に JSON が見つかりません')
  return raw.slice(start, end + 1)
}

/**
 * 画像（最大6枚）から3種のマスタを抽出する。
 * CANDIDATE_MODELS を新→古の順に試し、429/503/404 のときだけ次のモデルへフォールバックする。
 * それ以外のエラー（400・401・JSON不正など）は即座に throw する。
 */
export async function analyzeMasterImages(
  images: MasterImage[],
  existing: ExistingMasters,
): Promise<{ result: MasterResult; model: string }> {
  const apiKey = await getSetting('GEMINI_API_KEY')
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が未設定です（設定画面 または Secret Manager で投入）')
  }

  const prompt = buildPrompt(existing)
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: prompt },
  ]
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } })
  }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  })

  let lastErr: Error | null = null
  for (const model of CANDIDATE_MODELS) {
    let res: Response
    try {
      res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    } catch (e) {
      // ネットワーク到達不可。次のモデルでも同じはずなので即 throw。
      await logUsage(false)
      throw e instanceof Error ? e : new Error('Gemini への接続に失敗しました')
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      if (FALLBACK_STATUS.has(res.status)) {
        // 過負荷・未提供モデル → 次の（より枯れた）モデルへ
        lastErr = new Error(`model ${model}: HTTP ${res.status} ${detail.slice(0, 200)}`)
        continue
      }
      // それ以外（400/401/403 等）は設定・入力の問題。フォールバックしても無意味なので即 throw。
      await logUsage(false)
      throw new Error(`Gemini 解析に失敗しました (HTTP ${res.status}) ${detail.slice(0, 300)}`)
    }

    // 成功
    try {
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        promptFeedback?: { blockReason?: string }
      }
      if (json.promptFeedback?.blockReason) {
        throw new Error(`Gemini にブロックされました: ${json.promptFeedback.blockReason}`)
      }
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      if (!text.trim()) throw new Error('Gemini 応答が空でした')
      const parsed = masterResultSchema.parse(JSON.parse(stripToJson(text)))
      await logUsage(true)
      return { result: parsed, model }
    } catch (e) {
      // 200 だが応答が壊れている＝モデルを変えても直らない可能性が高い。即 throw。
      await logUsage(false)
      throw e instanceof Error ? e : new Error('Gemini 応答の解釈に失敗しました')
    }
  }

  await logUsage(false)
  throw lastErr ?? new Error('利用可能な Gemini モデルがありませんでした')
}
