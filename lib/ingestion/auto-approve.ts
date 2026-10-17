/**
 * 自動承認の判定（features.md §3-4 の拡張）。
 *
 * 「識字率100%なら自動承認・自動入力」をユーザーが設定で選べるようにするための純ロジック。
 * ただし Gemini の自己申告 confidence は「正解」ではなく自己採点なので、過信は誤承認＝出荷/請求事故に
 * 直結する。そこで安全側に倒し、次を **すべて満たした時だけ** 自動承認する:
 *   1. 設定で自動承認が有効
 *   2. 全明細の confidence がしきい値以上（既定 1.0＝100%）
 *   3. 取引先が一意に紐付いている（未紐付けは人手・失敗#6）
 *   4. 納品日が確定している（不明は人手・失敗#7）
 *   5. 全明細が商品マスタに一致している（名寄せ成功）
 * いずれか欠ければ pending_review（人手確認）にフォールバックする。
 *
 * 誤承認しても、修正内容は customer_parse_hints に学習され（lib/ingestion/learning）、
 * 次回以降の確信度・一致率が上がる＝自動承認が時間とともに安全になる設計。
 */

export interface AutoApproveItem {
  /** Gemini の自己申告確信度（0..1）。null は未採点扱い＝不可。 */
  confidence: number | null
  /** 商品マスタに名寄せできたか（lib/matching/name-match の結果）。 */
  productMatched: boolean
}

export interface AutoApproveInput {
  enabled: boolean
  /** 0..1。1.0 で識字率100%のみ。 */
  threshold: number
  items: AutoApproveItem[]
  customerMatched: boolean
  deliveryDateKnown: boolean
}

export type ApprovalReason =
  | 'auto_approve_disabled'
  | 'no_items'
  | 'customer_unmatched'
  | 'delivery_date_unknown'
  | 'low_confidence'
  | 'product_unmatched'
  | 'all_checks_passed'

export interface ApprovalDecision {
  action: 'auto_approve' | 'manual_review'
  reason: ApprovalReason
}

const manual = (reason: ApprovalReason): ApprovalDecision => ({ action: 'manual_review', reason })

/** 設定文字列からしきい値を解釈（既定 1.0、0..1 にクランプ）。 */
export function parseThreshold(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return 1.0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1.0
  return Math.min(1, Math.max(0, n))
}

/** 設定文字列が ON か（'on' 大文字小文字無視）。 */
export function isAutoApproveOn(raw: string | null | undefined): boolean {
  return raw?.trim().toLowerCase() === 'on'
}

/** 自動承認の可否を判定する。 */
export function decideReceiptApproval(input: AutoApproveInput): ApprovalDecision {
  if (!input.enabled) return manual('auto_approve_disabled')
  if (input.items.length === 0) return manual('no_items')
  if (!input.customerMatched) return manual('customer_unmatched')
  if (!input.deliveryDateKnown) return manual('delivery_date_unknown')
  // 1つでも確信度がしきい値未満（or 未採点）なら人手
  if (input.items.some((i) => i.confidence == null || i.confidence < input.threshold)) {
    return manual('low_confidence')
  }
  // 1つでも品目が未一致なら人手（誤った商品で自動入力しない）
  if (input.items.some((i) => !i.productMatched)) return manual('product_unmatched')
  return { action: 'auto_approve', reason: 'all_checks_passed' }
}
