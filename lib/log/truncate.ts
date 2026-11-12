/**
 * 壊れた設定値などをサーバーログに出すときの切り詰め。
 * 値が大きいとログが読めなくなるため、先頭 max 文字（既定300）までにし、全体の長さを添える。
 */
export function truncateForLog(value: unknown, max = 300): string {
  const s = typeof value === 'string' ? value : String(value)
  if (s.length <= max) return `${s}（全${s.length}文字）`
  return `${s.slice(0, max)}…（先頭${max}文字のみ・全${s.length}文字）`
}
