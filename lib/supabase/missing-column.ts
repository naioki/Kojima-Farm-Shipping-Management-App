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

export type WriteDroppingOptions = {
  /**
   * 行を特定するだけの列（insert / upsert の customer_id・product_id など）。列を外した結果、これらの列しか
   * 残らないなら「書く意味のある列が無い」として書き込みを投げない。update では指定不要（空 {} なら投げない）。
   */
  keyColumns?: string[]
}

/**
 * payload を書き込み、欠落列エラーならその列を除いて最大 maxRetry 回再試行する。
 * 欠落していない列は絶対に落とさない（必須データを黙って捨てない）。
 *
 * 書く列が残っていない（空 {}、または keyColumns だけ）ときは書き込みを投げず、
 * 「何も書かなかった成功」（data: null, error: null, skipped: true）を返す。
 * 本番に無い列だけの付随更新（例: 取引先ルールの has_seal / seal_text）が空の update で失敗し、
 * 毎回警告になるのを防ぐ。data を使う呼び出し元は、必ず実在する列を含む payload を渡すこと。
 */
export async function writeDroppingMissingColumns<T, E extends { code?: string; message?: string }>(
  payload: Record<string, unknown>,
  run: (p: Record<string, unknown>) => PromiseLike<{ data: T | null; error: E | null }>,
  maxRetry = 5,
  options: WriteDroppingOptions = {},
): Promise<{ data: T | null; error: E | null; droppedColumns: string[]; skipped?: boolean }> {
  const keyCols = new Set(options.keyColumns ?? [])
  const hasMeaningfulColumn = (p: Record<string, unknown>) => Object.keys(p).some((k) => !keyCols.has(k))
  let p = { ...payload }
  const dropped: string[] = []
  for (let i = 0; ; i++) {
    if (!hasMeaningfulColumn(p)) {
      return { data: null, error: null, droppedColumns: dropped, skipped: true }
    }
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

/**
 * テーブル自体が無い（マイグレーション未適用）エラーか。PGRST205（schema cache にテーブルが無い）/
 * 42P01（relation does not exist）。退避ストアへのフォールバックが用意されている「想定内の失敗」の判定に使う。
 */
export function isMissingRelationError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'PGRST205' || err.code === '42P01') return true
  return /Could not find the table|relation "?[\w.]+"? does not exist/.test(err.message ?? '')
}
