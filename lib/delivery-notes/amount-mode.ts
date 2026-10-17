/**
 * 納品書の金額表示モード（金額あり／後から手書き／金額なし）。
 *
 * 納品書は「納品の事実」を示す伝票で、金額を載せない運用が多い（請求は請求書で行う）。
 * そこで3モードを用意し、フォーム・プレビュー・PDF・既定値設定の全経路で共有する。
 *   - full : 単価・金額・税率・合計をすべて印字（従来動作）
 *   - blank: 列は出すが単価・金額・合計は空欄（印刷後に手書きで記入する用）。税率は既知なので印字。
 *   - none : 金額に関する列（単価・金額・税率）と合計を一切出さず、品目と数量だけ
 */

export type DeliveryAmountMode = 'full' | 'blank' | 'none'

export const DELIVERY_AMOUNT_MODES: { value: DeliveryAmountMode; label: string; hint: string }[] = [
  { value: 'full', label: '金額あり', hint: '単価・金額・税率と合計を印字' },
  { value: 'blank', label: '金額は後から手書き', hint: '単価・金額・合計を空欄で印字（印刷後に手書き）' },
  { value: 'none', label: '金額なし', hint: '品目と数量だけ印字（金額は請求書でご案内）' },
]

const LABELS = Object.fromEntries(DELIVERY_AMOUNT_MODES.map((m) => [m.value, m.label])) as Record<
  DeliveryAmountMode,
  string
>

/**
 * クエリ/設定値を安全に DeliveryAmountMode へ。未知値は fallback。
 * 既定を 'none'（金額なし）にしているのは、価格が後決め（出荷後に price_rules で確定）で
 * 納品時点では未確定なことが多く、誤った金額を印字するより出さない方が安全なため。
 * 保存済み納品書は amount_mode を明示保持しているのでフォールバックは効かない。
 */
export function parseAmountMode(
  value: string | null | undefined,
  fallback: DeliveryAmountMode = 'none',
): DeliveryAmountMode {
  return value === 'full' || value === 'blank' || value === 'none' ? value : fallback
}

export function amountModeLabel(mode: DeliveryAmountMode): string {
  return LABELS[mode]
}

/** 表示制御フラグ（プレビュー HTML と PDF で同じ判定を使う）。 */
export interface AmountVisibility {
  /** 単価・金額の列を出すか（none で false） */
  showAmountCols: boolean
  /** 単価・金額に実値を入れるか（blank は空欄、full のみ true） */
  fillAmounts: boolean
  /** 税率の列を出すか（none で false。blank では税率は既知なので印字） */
  showTaxCol: boolean
  /** 税率別合計のブロックを出すか（none で false） */
  showTotals: boolean
  /** 合計に実値を入れるか（blank は空欄で手書き用、full のみ true） */
  fillTotals: boolean
}

export function amountVisibility(mode: DeliveryAmountMode): AmountVisibility {
  return {
    showAmountCols: mode !== 'none',
    fillAmounts: mode === 'full',
    showTaxCol: mode !== 'none',
    showTotals: mode !== 'none',
    fillTotals: mode === 'full',
  }
}
