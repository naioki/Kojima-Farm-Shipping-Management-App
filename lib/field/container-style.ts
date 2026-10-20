export interface ContainerColorStyle {
  label: string
  bg: string
  text: string
  border: string
  leftBorder: string
  badgeClass: string
}

/**
 * 現場作業員が荷台や作業場で直感的にコンテナを識別できるカラー判定ユーティリティ
 * - 青コン: 背景 #DBEAFE, 文字/枠線 #1D4ED8, 左ボーダー border-l-blue-600
 * - 茶コン: 背景 #FEF3C7, 文字/枠線 #92400E, 左ボーダー border-l-amber-800
 * - 緑コン: 背景 #DCFCE7, 文字/枠線 #15803D, 左ボーダー border-l-emerald-700
 * - ダンボール: 背景 #FFEDD5, 文字/枠線 #9A3412, 左ボーダー border-l-orange-600
 * - 発泡: 背景 #F1F5F9, 文字/枠線 #334155, 左ボーダー border-l-slate-600
 */
export function getContainerColorStyle(containerType?: string | null): ContainerColorStyle {
  const c = (containerType ?? '').trim().toLowerCase()
  if (/青|ブルー|blue|青コン/.test(c)) {
    return {
      label: '青コン',
      bg: 'bg-[#DBEAFE]',
      text: 'text-[#1D4ED8]',
      border: 'border-[#1D4ED8]',
      leftBorder: 'border-l-blue-600',
      badgeClass: 'bg-[#DBEAFE] text-[#1D4ED8] border-2 border-[#1D4ED8]',
    }
  }
  if (/茶|ブラウン|brown|琥珀|アンバー|茶コン/.test(c)) {
    return {
      label: '茶コン',
      bg: 'bg-[#FEF3C7]',
      text: 'text-[#92400E]',
      border: 'border-[#92400E]',
      leftBorder: 'border-l-amber-800',
      badgeClass: 'bg-[#FEF3C7] text-[#92400E] border-2 border-[#92400E]',
    }
  }
  if (/緑|グリーン|green|緑コン/.test(c)) {
    return {
      label: '緑コン',
      bg: 'bg-[#DCFCE7]',
      text: 'text-[#15803D]',
      border: 'border-[#15803D]',
      leftBorder: 'border-l-emerald-700',
      badgeClass: 'bg-[#DCFCE7] text-[#15803D] border-2 border-[#15803D]',
    }
  }
  if (/ダンボール|段ボール|箱|carton|cardboard/.test(c)) {
    return {
      label: 'ダンボール',
      bg: 'bg-[#FFEDD5]',
      text: 'text-[#9A3412]',
      border: 'border-[#9A3412]',
      leftBorder: 'border-l-orange-600',
      badgeClass: 'bg-[#FFEDD5] text-[#9A3412] border-2 border-[#9A3412]',
    }
  }
  if (/発泡|スチロール|発泡スチロール/.test(c)) {
    return {
      label: '発泡',
      bg: 'bg-[#F1F5F9]',
      text: 'text-[#334155]',
      border: 'border-[#334155]',
      leftBorder: 'border-l-slate-600',
      badgeClass: 'bg-[#F1F5F9] text-[#334155] border-2 border-[#334155]',
    }
  }
  // デフォルト
  return {
    label: containerType || '青コン',
    bg: 'bg-[#DBEAFE]',
    text: 'text-[#1D4ED8]',
    border: 'border-[#1D4ED8]',
    leftBorder: 'border-l-blue-600',
    badgeClass: 'bg-[#DBEAFE] text-[#1D4ED8] border-2 border-[#1D4ED8]',
  }
}
