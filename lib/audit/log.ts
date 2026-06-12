import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditAction } from '@/types/database'

/**
 * audit_log への記録（tax.md：請求変更は7年保存・Undo の基盤）。
 * 変更前後の値と変わったフィールド名を残す。失敗は呼び出し側で握りつぶさない
 * （NEVER swallow errors silently・CLAUDE.md）。
 */
export interface AuditEntry {
  entityType: string
  entityId: string
  action: AuditAction
  oldValues?: Record<string, unknown> | null
  newValues?: Record<string, unknown> | null
  userId?: string | null
}

/** old/new を比較して変わったキーを返す。 */
export function diffFields(
  oldValues: Record<string, unknown> | null | undefined,
  newValues: Record<string, unknown> | null | undefined,
): string[] {
  if (!oldValues || !newValues) return []
  const keys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)])
  return [...keys].filter((k) => oldValues[k] !== newValues[k])
}

export async function writeAudit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
  const changedFields = diffFields(entry.oldValues, entry.newValues)
  const { error } = await supabase.from('audit_log').insert({
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    changed_fields: changedFields.length ? changedFields : null,
    old_values: entry.oldValues ?? null,
    new_values: entry.newValues ?? null,
    user_id: entry.userId ?? null,
  })
  if (error) throw new Error(`audit_log への記録に失敗: ${error.message}`)
}
