/**
 * DB未適用環境（マイグレーション未反映）で、存在しない列への書き込みが
 * 注文全体を失敗させないためのフォールバック。
 * PGRST204（schema cache に列が無い）/ 42703（列が無い）の場合、その列を外して再試行する。
 */
const MISSING_COL_RE = /Could not find the '([^']+)' column|column "?(?:[\w]+\.)?([\w]+)"? (?:of relation "[^"]+" )?does not exist/

export function isMissingColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'PGRST204' || err.code === '42703') return true
  return MISSING_COL_RE.test(err.message ?? '')
}

export function missingColumnName(err: { code?: string; message?: string } | null | undefined): string | null {
  if (!isMissingColumnError(err)) return null
  const m = (err?.message ?? '').match(MISSING_COL_RE)
  return m ? (m[1] ?? m[2] ?? null) : null
}

/**
 * payload を書き込み、欠落列エラーならその列を除いて最大 maxRetry 回再試行する。
 * 欠落していない列は絶対に落とさない（必須データを黙って捨てない）。
 */
export async function writeDroppingMissingColumns<T, E extends { code?: string; message?: string }>(
  payload: Record<string, unknown>,
  run: (p: Record<string, unknown>) => PromiseLike<{ data: T | null; error: E | null }>,
  maxRetry = 5,
): Promise<{ data: T | null; error: E | null; droppedColumns: string[] }> {
  let p = { ...payload }
  const dropped: string[] = []
  for (let i = 0; ; i++) {
    const res = await run(p)
    const col = missingColumnName(res.error)
    if (!res.error || !col || !(col in p) || i >= maxRetry) {
      return { data: res.data, error: res.error, droppedColumns: dropped }
    }
    const { [col]: _omit, ...rest } = p
    p = rest
    dropped.push(col)
  }
}
