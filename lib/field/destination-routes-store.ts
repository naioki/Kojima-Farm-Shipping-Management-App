import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { truncateForLog } from '@/lib/log/truncate'
import { isMissingFunctionError } from '@/lib/supabase/missing-column'
import type { PatchDestinationRouteArgs } from '@/types/database'

export type RouteOverride = {
  departureTime: string | null
  shippingRouteName: string | null
  /**
   * 納入先の規定コンテナ（`dest:<id>` のエントリだけが持つ）。`delivery_destinations.default_container_type`
   * 列が無い環境（本番）での唯一の保存先。古いデータには項目が無い（＝未設定）。
   */
  defaultContainerType?: string | null
}

/**
 * 退避ストアに保存されている1エントリの形。規定コンテナだけを保存した納入先は
 * departureTime / shippingRouteName の項目自体を持たない（出発時刻・便名の解決では「エントリ無し」と同じに扱い、
 * 取引先単位の出発時刻・便名を隠さないため）。
 */
type StoredEntry = {
  departureTime?: string | null
  shippingRouteName?: string | null
  defaultContainerType?: string | null
}

/** 出発時刻・便名のエントリか（規定コンテナだけのエントリは除く） */
function hasRouteFields(e: StoredEntry): boolean {
  return 'departureTime' in e || 'shippingRouteName' in e
}

/** 保存データを「出発時刻・便名」と「納入先ID → 規定コンテナ」に分ける */
function splitStored(stored: Record<string, StoredEntry>): {
  overrides: Record<string, RouteOverride>
  containers: Record<string, string>
} {
  const overrides: Record<string, RouteOverride> = {}
  const containers: Record<string, string> = {}
  for (const [k, raw] of Object.entries(stored)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const e = raw as StoredEntry
    if (hasRouteFields(e)) {
      overrides[k] = {
        ...e,
        departureTime: e.departureTime ?? null,
        shippingRouteName: e.shippingRouteName ?? null,
      }
    }
    if (k.startsWith('dest:') && typeof e.defaultContainerType === 'string' && e.defaultContainerType.trim()) {
      containers[k.slice('dest:'.length)] = e.defaultContainerType.trim()
    }
  }
  return { overrides, containers }
}

/**
 * 納入先の規定コンテナを「列の値 → 退避ストアの値」の順で解決する（列が無い本番では退避ストアだけが効く）。
 * 規定コンテナを使う画面・API はすべてこれを通す。
 */
export function resolveDestDefaultContainer(
  destId: string | null | undefined,
  columnValue: unknown,
  containers: Record<string, string> | null | undefined,
): string | null {
  if (typeof columnValue === 'string' && columnValue.trim()) return columnValue
  if (!destId || !containers) return null
  return containers[destId] ?? null
}

const SETTING_KEY = 'v5_destination_routes'

/**
 * 退避データの文字列を読む。JSON として壊れている（または中身がオブジェクトでない）ときは null。
 * 壊れた値は自然には直らないので、呼び出し側で記録したうえで作り直す。
 */
function parseRouteOverrides(raw: string): Record<string, StoredEntry> | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, StoredEntry>
    return null
  } catch {
    // 壊れた JSON は null を返して呼び出し側に任せる（記録・作り直しは呼び出し側）
    return null
  }
}

type ReadResult = { overrides: Record<string, StoredEntry>; broken: string | null }

/**
 * 退避データを読む。通信・DBエラーは throw する（空として上書きすると他の納入先の値を消すため）。
 * 読めたが JSON として壊れているときは broken に元の文字列を入れ、空として返す。
 */
async function readRouteOverridesStrict(admin: SupabaseClient): Promise<ReadResult> {
  const { data, error } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle()
  if (error) throw new Error(`出荷時間・便名の退避データの読み込みに失敗: ${error.message}`)
  if (!data?.value) return { overrides: {}, broken: null }
  const raw = String(data.value)
  const parsed = parseRouteOverrides(raw)
  if (!parsed) return { overrides: {}, broken: raw }
  return { overrides: parsed, broken: null }
}

export type RouteOverridesLoad = {
  overrides: Record<string, RouteOverride>
  /** 納入先ID → 規定コンテナ（退避ストアの値。列の値との解決は resolveDestDefaultContainer） */
  containers: Record<string, string>
  /** 通信・DBエラーのときだけ入る（利用者向けではない詳細。画面では警告帯の詳細欄に出す） */
  error: string | null
}

/**
 * 画面表示用に出発時刻・便名の退避データを読み、失敗を返す（画面側で警告帯を出せるように）。
 * - 通信・DBエラー → error に詳細を入れ、overrides は空
 * - 行が無い → 空・error なし
 * - JSON として壊れている／オブジェクトでない（"null"・配列・数値など）→ 例外を出さず空・error なし。
 *   壊れた値は次の保存（saveRouteOverride）で作り直されるため、画面に警告を出し続けない。console.error には残す。
 */
export async function loadRouteOverrides(admin: SupabaseClient): Promise<RouteOverridesLoad> {
  let r: ReadResult
  try {
    r = await readRouteOverridesStrict(admin)
  } catch (e) {
    return { overrides: {}, containers: {}, error: e instanceof Error ? e.message : String(e) }
  }
  if (r.broken !== null) {
    console.error(
      `[destination-routes-store] 退避データ（${SETTING_KEY}）が JSON として壊れています。空として扱います（次の保存で作り直されます）。値:`,
      truncateForLog(r.broken),
    )
  }
  return { ...splitStored(r.overrides), error: null }
}

/**
 * 0026未適用環境でも出荷時間・便名を確実に永続化するための app_settings ストア。
 * 表示用の読み込みなので、失敗時は console.error に残して空として扱う（失敗を画面に出すなら loadRouteOverrides）。
 */
export async function getRouteOverrides(admin: SupabaseClient): Promise<Record<string, RouteOverride>> {
  const r = await loadRouteOverrides(admin)
  if (r.error) console.error('[destination-routes-store] 出荷時間・便名の退避データを読めませんでした:', r.error)
  return r.overrides
}

/**
 * 指定されたキー群（納入先ID、取引先+納入先名、取引先デフォルト等）すべてに RouteOverride を記録・保存する。
 * 同じエントリに保存済みの規定コンテナは残す。
 */
export async function saveRouteOverride(
  admin: SupabaseClient,
  keys: string[],
  override: RouteOverride,
): Promise<void> {
  await saveDestinationOverride(admin, keys, {
    departureTime: override.departureTime ?? null,
    shippingRouteName: override.shippingRouteName ?? null,
    ...(override.defaultContainerType !== undefined ? { defaultContainerType: override.defaultContainerType ?? null } : {}),
  })
}

/**
 * 退避ストアのエントリを項目単位で更新する（undefined の項目は既存の値を残す）。
 * 規定コンテナだけを保存するときは { defaultContainerType } だけを渡す。
 * 失敗（読み込みの通信・DBエラー、保存エラー）は throw する。
 */
export async function saveDestinationOverride(
  admin: SupabaseClient,
  keys: string[],
  fields: StoredEntry,
): Promise<void> {
  const validKeys = keys.filter((k) => typeof k === 'string' && k.trim().length > 0)
  if (validKeys.length === 0) return

  // DB 関数（migrations/0033 patch_destination_route）があれば、キー単位の部分更新を DB 側の1文で行う。
  // 「いまの値」に対して指定キーの指定項目だけを足す／消すので、同時保存でも互いの変更を消さない。
  // 関数が無い環境（未適用）だけ従来の読み→マージ→書きにフォールバックする。
  const args = buildPatchArgs(validKeys, fields)
  const { error: rpcError } = await admin.rpc('patch_destination_route', args)
  if (!rpcError) return
  if (!isMissingFunctionError(rpcError)) {
    // 保存できていないのに成功扱いにしない（呼び出し側が警告として返す）
    throw new Error(`出荷時間・便名・規定コンテナの退避データの保存に失敗: ${rpcError.message}`)
  }
  await saveDestinationOverrideByReadMergeWrite(admin, validKeys, fields)
}

/** 項目単位の更新を DB 関数の引数（上書きする項目・消す項目）にする。undefined の項目は触らない。 */
function buildPatchArgs(keys: string[], fields: StoredEntry): PatchDestinationRouteArgs {
  const set: Record<string, string | null> = {}
  const unset: string[] = []
  if (fields.departureTime !== undefined) set.departureTime = fields.departureTime ?? null
  if (fields.shippingRouteName !== undefined) set.shippingRouteName = fields.shippingRouteName ?? null
  if (fields.defaultContainerType !== undefined) {
    const v = fields.defaultContainerType?.trim() || null
    if (v) set.defaultContainerType = v
    else unset.push('defaultContainerType')
  }
  return { p_keys: keys, p_set: set, p_unset: unset }
}

/** DB 関数が無い環境の従来経路（読み→マージ→書き）。 */
async function saveDestinationOverrideByReadMergeWrite(
  admin: SupabaseClient,
  validKeys: string[],
  fields: StoredEntry,
): Promise<void> {
  // 同時保存への備え: 書き込み直前に読み直し、項目単位でマージしてすぐ書く（読み→マージ→書きの間に他の await を
  // 挟まない）。それでも別の保存が「読み〜書き」の間に割り込むと、その保存の変更は消えうる（排他は未実装）。
  // 読み込み失敗（通信・DBエラー）を空扱いにすると、他の納入先の退避データを上書きで消してしまうため throw する。
  // 読めたが JSON として壊れている値は自然に直らないので、元の値をログに残して作り直す。
  const read = await readRouteOverridesStrict(admin)
  if (read.broken !== null) {
    console.error(
      `[destination-routes-store] 退避データ（${SETTING_KEY}）が壊れているため作り直します。壊れていた値:`,
      truncateForLog(read.broken),
    )
  }
  const existing = read.overrides
  for (const k of validKeys) {
    const prev = existing[k] && typeof existing[k] === 'object' && !Array.isArray(existing[k]) ? existing[k] : {}
    const next: StoredEntry = { ...prev }
    if (fields.departureTime !== undefined) next.departureTime = fields.departureTime ?? null
    if (fields.shippingRouteName !== undefined) next.shippingRouteName = fields.shippingRouteName ?? null
    if (fields.defaultContainerType !== undefined) {
      const v = fields.defaultContainerType?.trim() || null
      if (v) next.defaultContainerType = v
      else delete next.defaultContainerType
    }
    existing[k] = next
  }

  const { error } = await admin.from('app_settings').upsert(
    {
      key: SETTING_KEY,
      value: JSON.stringify(existing),
      is_secret: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
  // 保存できていないのに成功扱いにしない（呼び出し側が警告として返す）
  if (error) throw new Error(`出荷時間・便名・規定コンテナの退避データの保存に失敗: ${error.message}`)
}

/**
 * 1つの納入先の規定コンテナを「列の値 → 退避ストアの値」で解決する（注文の登録 API など1件だけ使う側向け）。
 * 列に値があれば退避ストアは読まない。退避ストアが読めないときは未設定扱い（ログに残す）で、登録自体は止めない。
 */
export async function loadDestDefaultContainer(
  admin: SupabaseClient,
  destId: string | null | undefined,
  columnValue: unknown,
): Promise<string | null> {
  if (typeof columnValue === 'string' && columnValue.trim()) return columnValue
  if (!destId) return null
  const r = await loadRouteOverrides(admin)
  if (r.error) console.error('[destination-routes-store] 規定コンテナの退避データを読めませんでした（未設定として扱います）:', r.error)
  return resolveDestDefaultContainer(destId, columnValue, r.containers)
}
