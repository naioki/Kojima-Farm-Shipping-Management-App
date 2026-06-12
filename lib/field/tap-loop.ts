import type { FieldStatus } from '@/types/database'

/**
 * 安全版タップループ（features.md §7 / 失敗#8）。
 * 提示された「白→緑✓→グレー🚚→白」の4タップ目で白に戻る循環は、誤タップで
 * 出荷済みが消えるため危険。前進のみ（循環させない）に修正する。
 *   not_started → packed → shipped（shipped で停止）
 * 後退・リセットは長押し＋確認ダイアログに分離する（このモジュールでは reset を別関数に）。
 */

const FORWARD: Record<FieldStatus, FieldStatus> = {
  not_started: 'packed',
  packed: 'shipped',
  shipped: 'shipped', // ★終端。タップで not_started に戻さない（出荷済み消失を防ぐ）
}

/** タップ1回の前進。shipped はそれ以上進まない（同値を返す）。 */
export function nextFieldStatus(current: FieldStatus): FieldStatus {
  return FORWARD[current]
}

/** これ以上前進できるか（shipped で false）。 */
export function canAdvance(current: FieldStatus): boolean {
  return current !== 'shipped'
}

/**
 * 長押し＋確認後のリセット（features.md §7）。通常タップからは決して呼ばない。
 * 1段階だけ戻す（shipped→packed→not_started）。一気に not_started へは戻さない。
 */
export function resetOneStep(current: FieldStatus): FieldStatus {
  const back: Record<FieldStatus, FieldStatus> = {
    shipped: 'packed',
    packed: 'not_started',
    not_started: 'not_started',
  }
  return back[current]
}

/** UI 表示用のメタ（色は CSS Variables 名で返し、ハードコード色を避ける・design.md）。 */
export interface FieldStatusMeta {
  label: string
  /** Tailwind カスタムテーマのトークン名（例: 'harvest-500'） */
  colorToken: string
  icon: 'circle' | 'check' | 'truck'
}

export const FIELD_STATUS_META: Record<FieldStatus, FieldStatusMeta> = {
  not_started: { label: '未着手', colorToken: 'line-strong', icon: 'circle' },
  packed: { label: '梱包完了', colorToken: 'harvest-500', icon: 'check' },
  shipped: { label: '出荷済', colorToken: 'ink-faint', icon: 'truck' },
}
