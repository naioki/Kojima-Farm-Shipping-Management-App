import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

/**
 * 収穫タスク（harvest_tasks）を「1明細1件」で作る・更新する共通処理。
 *
 * 収穫タスクを作る経路（承認・取り込みの自動承認・出荷一覧の追加・週の表のセル・手入力の注文）は
 * 必ずここを通す。素の insert は使わない。
 *
 * - 同じ order_item_id のタスクが既にあれば追加せず、計画の列（product_id / required_qty / task_date）
 *   だけを更新する。実績の列（status / assigned_to）は上書きしない
 *   （取り込みで承認待ちに戻った注文を再承認しても、現場の進捗が消えない・二重にならない）。
 * - 無ければ作る（status は DB 既定の not_started）。
 * - 一意制約（migrations/0034 の uq_harvest_tasks_order_item_id）の有無に依存しない:
 *   先に既存を読んでから分ける方式なので、制約の無い環境でも動く。制約がある環境で同時に作られて
 *   23505（一意制約違反）になった行は、更新に切り替える。
 * - 制約が入る前の環境で既に重複している明細は、重複している全行の計画の列をそろえる
 *   （重複の解消は migrations/0034 で行う）。
 *
 * 既存の読み込みに失敗したときは、二重登録を避けるため何も作らずに error を返す。
 * 戻り値の error は runSideEffect にそのまま渡せる形（{ message, code }）。
 */
export interface HarvestTaskPlan {
  product_id: string
  order_item_id: string
  required_qty: number
  /** 出荷日（delivery_date）の前日（engineering.md §3）。呼び出し側で shiftDateStr(delivery_date, -1) を渡す */
  task_date: string
}

export interface HarvestTaskUpsertResult {
  created: number
  updated: number
  error: { message: string; code?: string } | null
}

type Client = SupabaseClient<Database>
type ExistingRow = { id: string; order_item_id: string | null; product_id: string; required_qty: number | string; task_date: string }

const CHUNK = 100
const UNIQUE_VIOLATION = '23505'

function toErr(e: unknown): { message: string; code?: string } {
  if (e && typeof e === 'object' && 'message' in e) {
    const o = e as { message?: unknown; code?: unknown }
    return { message: String(o.message), ...(o.code ? { code: String(o.code) } : {}) }
  }
  return { message: String(e) }
}

export async function upsertHarvestTasks(client: Client, plans: HarvestTaskPlan[]): Promise<HarvestTaskUpsertResult> {
  // 同じ明細が2回渡されたら後のものを使う（1明細1件）
  const byItem = new Map<string, HarvestTaskPlan>()
  for (const p of plans) {
    if (!p.order_item_id || !p.product_id) continue
    byItem.set(p.order_item_id, p)
  }
  const result: HarvestTaskUpsertResult = { created: 0, updated: 0, error: null }
  if (byItem.size === 0) return result

  try {
    // 1) 既存のタスクを読む
    const itemIds = [...byItem.keys()]
    const existing = new Map<string, ExistingRow[]>()
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      const { data, error } = await client
        .from('harvest_tasks')
        .select('id, order_item_id, product_id, required_qty, task_date')
        .in('order_item_id', itemIds.slice(i, i + CHUNK))
      if (error) return { ...result, error: toErr(error) }
      for (const row of (data ?? []) as ExistingRow[]) {
        if (!row.order_item_id) continue
        const list = existing.get(row.order_item_id) ?? []
        list.push(row)
        existing.set(row.order_item_id, list)
      }
    }

    // 2) 既存があれば計画の列だけ更新（実績の列 status / assigned_to には触れない）
    const updateOne = async (p: HarvestTaskPlan): Promise<boolean> => {
      const { error } = await client
        .from('harvest_tasks')
        .update({ product_id: p.product_id, required_qty: p.required_qty, task_date: p.task_date })
        .eq('order_item_id', p.order_item_id)
      if (error) {
        if (!result.error) result.error = toErr(error)
        return false
      }
      result.updated++
      return true
    }

    const toInsert: HarvestTaskPlan[] = []
    for (const p of byItem.values()) {
      const rows = existing.get(p.order_item_id)
      if (!rows || rows.length === 0) {
        toInsert.push(p)
        continue
      }
      const unchanged = rows.every(
        (r) => r.product_id === p.product_id && Number(r.required_qty) === Number(p.required_qty) && r.task_date === p.task_date,
      )
      if (unchanged) {
        result.updated++
        continue
      }
      await updateOne(p)
    }

    // 3) 無ければ作る。一意制約のある環境で同時に作られていたら（23505）、更新に切り替える
    if (toInsert.length > 0) {
      const { error } = await client.from('harvest_tasks').insert(
        toInsert.map((p) => ({
          product_id: p.product_id,
          order_item_id: p.order_item_id,
          required_qty: p.required_qty,
          task_date: p.task_date,
        })),
      )
      if (!error) {
        result.created += toInsert.length
      } else if (error.code === UNIQUE_VIOLATION) {
        // 一括 insert は全体が取り消されるので、1件ずつ「作る → 既にあれば更新」でやり直す
        for (const p of toInsert) {
          const one = await client.from('harvest_tasks').insert({
            product_id: p.product_id,
            order_item_id: p.order_item_id,
            required_qty: p.required_qty,
            task_date: p.task_date,
          })
          if (!one.error) {
            result.created++
          } else if (one.error.code === UNIQUE_VIOLATION) {
            await updateOne(p)
          } else if (!result.error) {
            result.error = toErr(one.error)
          }
        }
      } else if (!result.error) {
        result.error = toErr(error)
      }
    }
  } catch (e) {
    if (!result.error) result.error = toErr(e)
  }
  return result
}
