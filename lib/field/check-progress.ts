/**
 * 出発前ダブルチェックの「途中まで確認した」状態を端末に残す。
 *
 * これまで確認チェックは React の state だけに持っていたため、12行中8行まで
 * 確認したところで別画面を見に行く・端末がスリープしてタブが破棄される、で
 * 全部消えて最初からやり直しだった。いちばん失いたくない途中経過が
 * いちばん失われやすい状態になっていた。
 *
 * サーバーには保存しない。これは「積込OK を押す前の手元のメモ」であり、
 * 業務記録（deliveries / delivery_events）は積込OK以降が正。端末ローカルに
 * 留めることで、他の人の画面に中途半端な確認状態が出るのも防ぐ。
 *
 * 保存先は localStorage（IndexedDB ほどの容量は要らず、同期APIで扱いが単純）。
 * 日付ごとにキーを分け、古い日付は読み込み時に掃除する（端末に溜め続けない）。
 */

const PREFIX = 'kojima:delivery-check:'

/** 配送単位（取引先×納入先）×日付で一意なキー。 */
export function progressKey(deliveryDate: string, groupKey: string): string {
  return `${PREFIX}${deliveryDate}:${groupKey}`
}

/** 保存文字列 → 明細IDの集合。壊れた値は「未チェック」に倒す（例外を出さない）。 */
export function parseProgress(raw: string | null): Set<string> {
  if (!raw) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

/** 明細IDの集合 → 保存文字列。 */
export function serializeProgress(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids])
}

/**
 * 保存済みのうち、いま画面にある明細だけを残す。
 * 事務所が明細を消した・数量を分けた等で、存在しないIDのチェックが
 * 残り続けると「全部チェック済み」に見えてしまうため。
 */
export function reconcileProgress(
  saved: ReadonlySet<string>,
  currentItemIds: readonly string[],
): Set<string> {
  const present = new Set(currentItemIds)
  return new Set([...saved].filter((id) => present.has(id)))
}

/** この日付以外の保存キー（前日までの残骸）を洗い出す。 */
export function staleKeys(allKeys: readonly string[], keepDate: string): string[] {
  return allKeys.filter((k) => k.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${keepDate}:`))
}
