import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit, type AuditEntry } from '@/lib/audit/log'

/**
 * 本体の書き込みに付随する更新（収穫数の同期・配送チェックの戻し・受信票の付け替え・退避保存など）の
 * 失敗を「黙って消さない」ための共通処理（engineering.md §5・CLAUDE.md NEVER swallow errors）。
 *
 * supabase-js は失敗しても例外を投げず `{ error }` を返すため、空の catch で囲む書き方では
 * 失敗を一切検知できない。付随更新は必ずこのヘルパーを通し、戻り値の error を確認する。
 *
 * - 詳細（テーブル名・DBのエラー文）は console.error に出す（サーバーログ）。
 * - 現場向けの文言（userMessage）は warnings に積み、成功応答の `warnings: string[]` で返す。
 *   本体の書き込みが成功していれば 500 にはしない（成功＋警告）。
 * - userMessage を省略すると console.error のみ（監査ログなど、現場が対処できないもの）。
 */
export type SideEffectResult = { error?: { message?: string; code?: string } | null } | null | undefined

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message?: unknown; code?: unknown }
    return e.code ? `${String(e.message)} (code=${String(e.code)})` : String(e.message)
  }
  return String(err)
}

/** 付随更新の失敗を記録する（console.error ＋ 任意で警告文）。 */
export function noteSideEffectFailure(
  warnings: string[] | null,
  logTag: string,
  err: unknown,
  userMessage?: string,
): void {
  console.error(`${logTag}:`, errorText(err))
  if (warnings && userMessage && !warnings.includes(userMessage)) warnings.push(userMessage)
}

/**
 * 付随更新を実行し、失敗（error の返却・例外）を記録する。成功なら true。
 * 例: await runSideEffect(warnings, '[api/x] harvest_tasks の更新に失敗', '…', () => supabase.from(...).update(...))
 */
export async function runSideEffect(
  warnings: string[] | null,
  logTag: string,
  userMessage: string | undefined,
  fn: () => PromiseLike<SideEffectResult>,
): Promise<boolean> {
  try {
    const res = await fn()
    if (res?.error) {
      noteSideEffectFailure(warnings, logTag, res.error, userMessage)
      return false
    }
    return true
  } catch (e) {
    noteSideEffectFailure(warnings, logTag, e, userMessage)
    return false
  }
}

/**
 * 本体の書き込み成功後の監査ログ。失敗しても操作は成功扱いのまま（500 にしない）で、
 * console.error に残す。userMessage を渡すと警告にも載せる。
 */
export async function writeAuditAfterSuccess(
  supabase: SupabaseClient,
  entry: AuditEntry,
  logTag: string,
  warnings: string[] | null = null,
  userMessage?: string,
): Promise<boolean> {
  try {
    await writeAudit(supabase, entry)
    return true
  } catch (e) {
    noteSideEffectFailure(warnings, logTag, e, userMessage)
    return false
  }
}

/** 成功応答に warnings を足す（警告が無いときは応答の形を変えない）。 */
export function withWarnings<T extends object>(body: T, warnings: string[]): T & { warnings?: string[] } {
  return warnings.length > 0 ? { ...body, warnings } : body
}
