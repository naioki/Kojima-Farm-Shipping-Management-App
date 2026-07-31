import type { FieldStatus } from '@/types/database'
import type { RowStatusKey } from './shipment-sort'

/**
 * 現場4区分の配色（単一の正）。
 *
 * これまで画面ごとに配色マップを持っていたため、同じ状態が画面によって別の色に
 * なっていた（出荷一覧では 梱包完了=青／出荷済=緑、マトリックスでは 梱包完了=緑／
 * 出荷済=グレー）。現場は出荷一覧とマトリックスを行き来するので、
 * 「緑＝終わった」と覚えた人がマトリックスの緑（＝まだ梱包しただけ）を
 * 出荷済みと誤読する。状態の色は必ずこのファイルから取る。
 *
 * 基準は出荷一覧のサマリーチップ（現場が最もよく見る画面）:
 *   未着手=グレー → 中断=黄 → 梱包完了=青 → 出荷済=緑
 * 進むほど「濃く・前向きな色」になり、完了（緑）が終着点だと直感的に分かる。
 *
 * 色だけに頼らないこと（design.md / WCAG AA）。アイコン・ラベル文字・
 * マトリックスの数字の形（○囲み／打消し線）を必ず併用する。
 *
 * Tailwind JIT は実行時に組み立てたクラス名を拾えないため、すべて literal で持つ。
 */
export interface FieldStatusStyle {
  /** 現場に見せるラベル */
  label: string
  /** アイコン等に当てる文字色 */
  text: string
  /** サマリーチップの背景＋文字色 */
  chip: string
  /** チップ内アイコンの色 */
  chipIcon: string
  /** 出荷一覧カードの左ボーダー＋背景トーン */
  card: string
}

export const FIELD_STATUS_STYLE: Record<RowStatusKey, FieldStatusStyle> = {
  not_started: {
    label: '未着手',
    text: 'text-line-strong',
    chip: 'bg-bg-soft text-ink-soft',
    chipIcon: 'text-line-strong',
    card: 'border-l-line-strong bg-bg-card',
  },
  interrupted: {
    label: '中断',
    text: 'text-warning',
    chip: 'bg-warning-bg text-warning',
    chipIcon: 'text-warning',
    card: 'border-l-warning bg-warning-bg/20',
  },
  packed: {
    label: '梱包完了',
    text: 'text-trust-500',
    chip: 'bg-trust-50 text-trust-700',
    chipIcon: 'text-trust-500',
    card: 'border-l-trust-500 bg-trust-50/40',
  },
  shipped: {
    label: '出荷済',
    text: 'text-harvest-500',
    chip: 'bg-harvest-50 text-harvest-700',
    chipIcon: 'text-harvest-500',
    card: 'border-l-line bg-bg-soft/60 opacity-80',
  },
}

/**
 * FieldStatus（3状態）の配色。
 * 「中断」は field_status ではなく「できた数 < 受注」から決まる表示上の区分なので、
 * 4区分が必要な画面は rowStatusKey() を通してから FIELD_STATUS_STYLE を引くこと。
 */
export function fieldStatusStyle(status: FieldStatus): FieldStatusStyle {
  return FIELD_STATUS_STYLE[status]
}
