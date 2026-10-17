/**
 * 取引先ごとのフォーマット学習（features.md §4 名寄せの強化）。
 *
 * 狙い：一度 admin が「この取引先の『桃太郎』はトマトのこと」と修正したら、それを記録し、
 * 次回その取引先の Gemini 解析プロンプトに few-shot で注入して精度を上げる。
 * 学習が進むほど確信度・一致率が上がり、自動承認（lib/ingestion/auto-approve）が安全になる。
 *
 * ここは純ロジック（プロンプト文の組み立て・正規化・学習要否判定）。保存は API/DB 側で行う。
 */

export interface ParseHint {
  /** 取引先が使う表記（OCR/原文のまま） */
  rawName: string
  /** 正しい品目名（マスタのスナップショット） */
  correctedName: string | null
  /** 学習の信頼度（出現回数）。多いほど確か。 */
  hitCount?: number
}

/** 照合用の正規化（全角→半角・空白/記号除去・小文字化）。name-match と整合。 */
export function normalizeRawName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[　・，,。．.]/g, '')
    .toLowerCase()
}

/**
 * Gemini プロンプトに注入する few-shot 文を組み立てる。
 * ヒントが無ければ空文字（プロンプトを汚さない）。出現回数の多い順に最大 max 件。
 */
export function buildCustomerHintText(hints: ParseHint[], max = 20): string {
  const usable = hints
    .filter((h) => h.rawName.trim() !== '' && (h.correctedName ?? '').trim() !== '')
    .sort((a, b) => (b.hitCount ?? 1) - (a.hitCount ?? 1))
    .slice(0, max)
  if (usable.length === 0) return ''
  const lines = usable.map((h) => `- 「${h.rawName}」→ ${h.correctedName}`)
  return [
    'この取引先で過去に確認された表記の対応です。同じ/似た表記が出たら product_name をこれに合わせてください:',
    ...lines,
  ].join('\n')
}

export interface CorrectionInput {
  /** AI が読み取った生表記 */
  rawName: string
  /** admin が選び直した正しい品目名（null は紐付け解除＝学習しない） */
  correctedName: string | null
  /** AI が当初出した名前（同じなら修正なし＝学習不要） */
  aiName?: string | null
}

/**
 * 修正を学習すべきか。
 * - rawName が空 → 学習しない
 * - correctedName が空/未確定 → 学習しない
 * - AI の出力と正解が同じ（正規化後） → すでに正しいので学習不要
 */
export function shouldLearnCorrection(input: CorrectionInput): boolean {
  if (input.rawName.trim() === '') return false
  if (!input.correctedName || input.correctedName.trim() === '') return false
  if (input.aiName && normalizeRawName(input.aiName) === normalizeRawName(input.correctedName)) {
    return false
  }
  return true
}

/** 既知ヒントから rawName に一致する正解名を引く（正規化一致）。無ければ null。 */
export function lookupHint(hints: ParseHint[], rawName: string): string | null {
  const key = normalizeRawName(rawName)
  const hit = hints.find((h) => normalizeRawName(h.rawName) === key)
  return hit?.correctedName ?? null
}
