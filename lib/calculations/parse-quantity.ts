import Decimal from 'decimal.js'

/**
 * スマートパース（features.md §5 / PROMPT.md Phase A）。
 *
 * 数量表記の誤解釈は出荷ミス・請求ミスに直結するため、ここに解釈ロジックを集約し
 * 単体テストで固定する。浮動小数点は使わず Decimal.js で計算する（tax.md 準拠）。
 *
 * 解釈ルール:
 *   "15c2"  → 15ケース + 端数2パック = 15 * packs_per_case + 2（総数）
 *   "15c"   → 15ケース（端数0）        = 15 * packs_per_case
 *   "10"    → 10（総数そのまま）
 *   "x58"   → ★絶対ルール：x の後の数字は「箱数」ではなく「合計個数」。
 *             先頭に数字があっても（"3x58" 等）合計は x の後の 58 とする（掛け算しない）。
 *   ""(空欄) → その日の出荷レコードを削除する指示（type:'delete'）
 *
 * 全角数字・全角 ｃ/ｘ・スペースは正規化してから解釈する（FAX/手書き対策）。
 */

/** c記法の P/C 換算に必要な取引先×商品ルール値 */
export interface ParseQuantityOptions {
  /** customer_product_rules.packs_per_case（1ケースあたりのパック数） */
  packsPerCase?: number | null
}

export type ParseQuantityResult =
  /** 空欄＝削除指示（マトリックス入力仕様） */
  | { type: 'delete' }
  /** 解釈成功。total は常に総数（パック/個） */
  | {
      type: 'ok'
      total: Decimal
      /** c記法のケース数。c記法以外は null */
      cases: number | null
      /** c記法の端数。c記法以外は null */
      loose: number | null
      interpretation: 'plain' | 'cases' | 'x_total'
      /** 人間の最終確認が望ましい場合 true（UIで黄色表示） */
      needsConfirmation: boolean
      warning?: string
    }
  /** 解釈不能・前提不足 */
  | { type: 'error'; reason: ParseErrorReason; input: string }

export type ParseErrorReason =
  | 'packs_per_case_required' // c記法だが P/C 未設定で総数を確定できない
  | 'unparseable' // 数字として解釈できない
  | 'negative' // 負数は不正

/** 全角→半角・記号正規化。"１５ｃ２" → "15c2"、"ｘ５８" → "x58" */
function normalize(input: string): string {
  return input
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)) // 全角数字→半角
    .replace(/[ｃＣ]/g, 'c') // 全角C→c
    .replace(/[ｘＸ]/g, 'x') // 全角X→x
    .replace(/\s+/g, '') // 空白除去
}

const C_NOTATION = /^(\d+)c(\d*)$/i // 15c2 / 15c
const X_NOTATION = /x(\d+)$/i // x58 / 3x58（x の後の数字を総数に採用）
const PLAIN = /^\d+(?:\.\d+)?$/

/**
 * 数量文字列を解釈して総数（Decimal）に正規化する。
 * @param rawInput ユーザー/OCR が入れた生文字列
 * @param options P/C など換算に必要な取引先ルール
 */
export function parseQuantity(
  rawInput: string,
  options: ParseQuantityOptions = {},
): ParseQuantityResult {
  // 空欄（空白のみ含む）＝削除指示。0 とは区別する。
  if (rawInput == null || rawInput.trim() === '') return { type: 'delete' }

  const s = normalize(rawInput)
  if (s === '') return { type: 'delete' }

  const packsPerCase = options.packsPerCase ?? null

  // ① x記法（絶対ルール）を最優先で判定する。
  //    "x" を含む時点で「x の後の数字＝合計個数」。掛け算は決して行わない。
  const xMatch = s.match(X_NOTATION)
  if (xMatch && /x/i.test(s)) {
    const total = new Decimal(xMatch[1]!)
    return {
      type: 'ok',
      total,
      cases: null,
      loose: null,
      interpretation: 'x_total',
      needsConfirmation: false,
      warning: 'x記法：x の後の数字を合計個数として解釈（箱数ではない）',
    }
  }

  // ② c記法（ケース＋端数）
  const cMatch = s.match(C_NOTATION)
  if (cMatch) {
    const cases = Number(cMatch[1])
    const loose = cMatch[2] === '' ? 0 : Number(cMatch[2])
    if (packsPerCase == null || !(packsPerCase > 0)) {
      // P/C が無いと総数を確定できない → 必ず人間確認（勝手に推測しない）
      return { type: 'error', reason: 'packs_per_case_required', input: rawInput }
    }
    const total = new Decimal(cases).times(packsPerCase).plus(loose)
    return {
      type: 'ok',
      total,
      cases,
      loose,
      interpretation: 'cases',
      needsConfirmation: false,
    }
  }

  // ③ プレーン数値
  if (PLAIN.test(s)) {
    const total = new Decimal(s)
    if (total.isNegative()) return { type: 'error', reason: 'negative', input: rawInput }
    return {
      type: 'ok',
      total,
      cases: null,
      loose: null,
      interpretation: 'plain',
      needsConfirmation: false,
    }
  }

  return { type: 'error', reason: 'unparseable', input: rawInput }
}

export interface ContainerBreakdown {
  /** 総数 */
  total: Decimal
  /** コンテナ数（container_capacity で割った商の整数部） */
  containers: number
  /** 端数（コンテナに満たない残り） */
  remainder: Decimal
}

/**
 * 総数をコンテナ数＋端数に分解する（features.md §8：総数/コンテナ数/端数 表示）。
 * capacity 不明・0以下なら分解せず null（呼び出し側は総数のみ表示）。
 */
export function decomposeByContainer(
  total: Decimal,
  containerCapacity: number | null | undefined,
): ContainerBreakdown | null {
  if (containerCapacity == null || !(containerCapacity > 0)) return null
  const cap = new Decimal(containerCapacity)
  const containers = total.dividedToIntegerBy(cap)
  const remainder = total.minus(containers.times(cap))
  return { total, containers: containers.toNumber(), remainder }
}
