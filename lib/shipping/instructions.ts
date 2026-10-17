import Decimal from 'decimal.js'
import type { FractionPolicy } from '@/types/database'

/**
 * 出荷作業指示書の生成（features.md §9）。
 * 承認済み注文を取引先別の梱包指示に展開する。荷姿（P/C・ラベル・テープ・端数ポリシー）を
 * customer_product_rules から取り込む。農園が制御できない荷姿（組合指定等）は
 * 自動確定せず needsConfirm を立てて人間確認に回す。
 */

export interface ShippingRule {
  packsPerCase?: number | null
  containerType?: string | null
  labelSpec?: string | null
  tapeColor?: string | null
  fractionPolicy: FractionPolicy
  packingNotes?: string | null
}

export interface ShippingAllocation {
  customerName: string
  /** その取引先への総数（パック/個） */
  quantity: number
  rule: ShippingRule
}

export interface ShippingLine {
  customerName: string
  cases: number | null
  loose: number | null
  containerType: string | null
  labelSpec: string | null
  tapeColor: string | null
  /** 人間確認が必要（端数ポリシー confirm／P/C不明／組合指定等） */
  needsConfirm: boolean
  note: string | null
}

export interface ShippingInstruction {
  productName: string
  total: Decimal
  lines: ShippingLine[]
}

/** 取引先別の割当てを梱包指示に展開する。 */
export function buildShippingInstruction(
  productName: string,
  allocations: ShippingAllocation[],
): ShippingInstruction {
  let total = new Decimal(0)
  const lines: ShippingLine[] = allocations.map((a) => {
    const qty = new Decimal(a.quantity)
    total = total.plus(qty)
    const pc = a.rule.packsPerCase
    let cases: number | null = null
    let loose: number | null = null
    if (pc != null && pc > 0) {
      const c = qty.dividedToIntegerBy(pc)
      cases = c.toNumber()
      loose = qty.minus(c.times(pc)).toNumber()
    }
    // 端数ポリシーが confirm で端数が出る、または P/C 不明なら人間確認
    const needsConfirm =
      (a.rule.fractionPolicy === 'confirm' && (loose == null || loose > 0)) || pc == null || !(pc > 0)
    return {
      customerName: a.customerName,
      cases,
      loose,
      containerType: a.rule.containerType ?? null,
      labelSpec: a.rule.labelSpec ?? null,
      tapeColor: a.rule.tapeColor ?? null,
      needsConfirm,
      note: a.rule.packingNotes ?? null,
    }
  })
  return { productName, total, lines }
}
