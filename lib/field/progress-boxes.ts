/**
 * 出荷一覧（収穫・パック）上部の進捗（目標・完成・残り・翌日分）と、AI相談窓口の合計箱数を数える純関数。
 *
 * 規則（engineering.md §3）:
 * - 青梗菜は、取引先別の個別入数にかかわらず品目全体で一律 `Math.ceil(総パック数 / 20)`。
 * - それ以外の品目は、各明細の実際の入数（カード・コンテナ内訳と同じ解決＝lib/masters/packs-per-case.ts）で
 *   明細ごとに箱数を数えて合計する（カードの箱数の合計と一致する）。
 * - 入数が不明（0・負値・数値でない）のときは既定 20。
 */
import { DEFAULT_PACKS_PER_CASE, positiveNumber } from '@/lib/masters/packs-per-case'

/** 青梗菜の進捗を一律で数えるときの1箱のパック数 */
export const BOK_CHOY_PROGRESS_PACKS_PER_BOX = 20

/**
 * 青梗菜（チンゲン菜）の品目か。品目名が無いときは青梗菜として扱う
 * （この規則を導入した f97cd2c の isBokChoy と同じ条件）。
 */
export function isBokChoyProduct(productName: string | null | undefined): boolean {
  if (!productName) return true
  const n = productName.normalize('NFKC')
  return n.includes('青梗菜') || n.includes('チンゲン') || n.includes('ちんげん')
}

export interface ProgressLine {
  /** 品目名（青梗菜の判定に使う） */
  productName: string | null | undefined
  /** 注文パック数 */
  qty: number
  /** 完了パック数（梱包済みなら qty、途中なら入力済みの数） */
  donePacks?: number
  /** 1箱の入数（カードと同じ解決結果） */
  packsPerCase: number | null | undefined
  /** 少量サンプル（箱に数えない）。カードの isSmallSample と同じ判定を呼び出し側で渡す */
  isSmallSample?: boolean
}

export interface ProgressBoxes {
  totalPacks: number
  completedPacks: number
  totalBoxes: number
  completedBoxes: number
  remainingBoxes: number
}

/** 完成した（満杯の）箱数。全数できていれば総箱数（切り上げ）にそろえる（shipment-sort の completedCaseCount と同じ規則）。 */
function fullCases(donePacks: number, totalPacks: number, ppc: number): number {
  const totalCases = Math.ceil(Math.max(0, totalPacks) / ppc)
  if (donePacks >= totalPacks) return totalCases
  return Math.min(totalCases, Math.floor(Math.max(0, donePacks) / ppc))
}

export function computeProgressBoxes(lines: readonly ProgressLine[]): ProgressBoxes {
  let totalPacks = 0
  let completedPacks = 0
  let bokTotal = 0
  let bokDone = 0
  let otherBoxes = 0
  let otherCompleted = 0

  for (const l of lines) {
    const qty = Math.max(0, Number(l.qty) || 0)
    const done = Math.max(0, Math.min(qty, Number(l.donePacks) || 0))
    totalPacks += qty
    completedPacks += done
    if (qty === 0) continue
    if (isBokChoyProduct(l.productName)) {
      bokTotal += qty
      bokDone += done
      continue
    }
    if (l.isSmallSample) continue
    const ppc = positiveNumber(l.packsPerCase) ?? DEFAULT_PACKS_PER_CASE
    otherBoxes += Math.ceil(qty / ppc)
    otherCompleted += fullCases(done, qty, ppc)
  }

  const bokBoxes = bokTotal > 0 ? Math.ceil(bokTotal / BOK_CHOY_PROGRESS_PACKS_PER_BOX) : 0
  const bokCompleted = bokTotal > 0 ? fullCases(bokDone, bokTotal, BOK_CHOY_PROGRESS_PACKS_PER_BOX) : 0
  const totalBoxes = bokBoxes + otherBoxes
  const completedBoxes = bokCompleted + otherCompleted
  return {
    totalPacks,
    completedPacks,
    totalBoxes,
    completedBoxes,
    remainingBoxes: Math.max(0, totalBoxes - completedBoxes),
  }
}

/**
 * 前日からの持ち越し（箱数）をパック数の目安に換算する。進捗の箱数と同じ規則に合わせ、青梗菜は一律
 * 20P/箱で換算できる。それ以外の品目は明細ごとに入数が違い、持ち越しの箱の入数を確定できないので null
 * （「約 N P」の表示を出さない）。
 */
export function carryoverPacksEstimate(productName: string | null | undefined, carryoverBoxes: number): number | null {
  const boxes = Math.max(0, Number(carryoverBoxes) || 0)
  if (!isBokChoyProduct(productName)) return null
  return boxes * BOK_CHOY_PROGRESS_PACKS_PER_BOX
}
