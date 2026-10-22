/**
 * 小島農園 統合受発注パイプライン データスキーマ・正規化・検算モジュール（TypeScript版）.
 *
 * `kojima-farm-order-pipeline` (Ver 4.1 ARCHITECTURE.md 第3章・第4章 / app/schemas.py) の設計思想を完全継承：
 * 1. 「受注明細」全22列モデルとシステム管理17列／現場操作5列（上書き厳禁）の分離
 * 2. 注文キー正規化関数 `generateOrderKey`（NFKC・波ダッシュU+301C統一・法人格除去・品目統一・空白除去/小文字化・同一伝票内 #2, #3 付与）
 * 3. 入数20 / 入数24（NSK）および勘兵衛（ケース単位入力）の検算・換算ロジックと固定書式 `総数{総P}点（{ケース}ケース＋端数{端数}点）`
 * 4. コンテナ集計ロジック（納品先別端数切り上げ・青コン/茶コン/NSK折りたたみ/通常コンテナ分類）
 * 5. Kojima-FAX (LIFEBOOK `drive_backup.py`) から渡される Google Drive 原本URL (`source_file_url`) のプレビュー変換（Cloudflare R2・Supabase Storage 不要）
 */

export const ORDER_DETAILS_HEADERS_22 = [
  '処理日時', // A (1): 初回登録時の yyyy-MM-dd HH:mm（既存行更新時は書き換えない）
  '伝票No', // B (2): FAX記載の伝票番号（例: NO. 2665）
  '発注元', // C (3): 取引先名（標準表記）
  '納品日', // D (4): yyyy-MM-dd
  '納品先', // E (5): 標準表記に揃えた納品先名
  '品目名', // F (6): チンゲン菜（表記ゆれ統一）
  '規格', // G (7): 標準規格表記（例: 2〜3株 (入数20)）
  '数量/ケース', // H (8): 固定書式 総数{総P}点（{ケース}ケース＋端数{端数}点）
  '原本ファイルURL', // I (9): Kojima-FAX が Google Drive に保存した原本閲覧URL
  'パック済', // J (10): [現場操作列] チェックボックス (BOOL)
  '出荷済', // K (11): [現場操作列] チェックボックス (BOOL)
  '更新日時', // L (12): 登録・更新した yyyy-MM-dd HH:mm
  'メモ', // M (13): [現場操作列] 現場スタッフメモ（絶対上書き厳禁）
  '注文キー', // N (14): 3.2の規則で生成した一意キー
  '総パック数', // O (15): 数値（数量の唯一の正）
  'ケース', // P (16): 数値（総パック数 ÷ 入数 の整数部）
  '端数P', // Q (17): 数値（総パック数 ÷ 入数 の余り）
  '状態', // R (18): 有効 / 要確認 / 取消
  '特記事項', // S (19): 現場スタッフに見せる注意文
  '新規追加', // T (20): FAXに ★ 印があれば ★、無ければ空欄
  '進捗確認時総P', // U (21): [現場操作列] 進捗確認時の総パック数
  '数量変更メモ', // V (22): [現場操作列] MM/dd HH:mm {旧総P}→{新総P}P 等
] as const

export type OrderStatusLabel = '有効' | '要確認' | '取消'

export type ContainerTypeLabel =
  | '青コン'
  | '茶コン'
  | '房総青コン'
  | '段ボール'
  | '農業総研専用折りたたみコンテナ'
  | '通常コンテナ'

export type SourceChannelLabel = 'FAX' | 'LINE' | 'DISCORD' | 'WEB'

export interface PipelineAlertItem {
  alert_id: string
  created_at: string
  alert_type: '数量変更' | '要返答' | '要確認' | '古い伝票No後着' | string
  message: string
  resolved: boolean
}

export interface PipelineExtractedItem {
  slip_no: string
  client_name: string
  delivery_date: string
  destination: string
  item_name: string
  spec: string
  unit_count: number
  is_case_input: boolean
  total_packs: number
  cases: number
  remainder_packs: number
  quantity_case_text: string
  status: OrderStatusLabel
  special_notes: string
  new_addition_mark: string
  order_key: string
  source_file_url: string
  is_approximate: boolean
  is_handwritten_modified: boolean
  has_reply_required: boolean
  explicit_cancel_in_slip: boolean
  container_type: ContainerTypeLabel
  container_boxes: number
  confidence: number
}

export interface ContainerSummaryItem {
  delivery_date: string
  destination: string
  container_type: ContainerTypeLabel
  total_packs: number
  cases: number
  remainder_packs: number
  boxes: number
}

export interface PipelineSlipResult {
  is_order_fax: boolean
  skip_reason: string | null
  source_channel: SourceChannelLabel
  client_name: string
  slip_no: string
  is_full_resending_matrix: boolean
  source_file_id: string
  source_file_name: string
  source_file_url: string
  items: PipelineExtractedItem[]
  alerts: PipelineAlertItem[]
  ai_learned_rule_candidate: string | null
}

// 除去対象の法人格パターン（NFKC前後どちらでもマッチ）
const CORPORATE_TITLES_RE = /(農事組合法人|株式会社|有限会社|合同会社|（株）|\(株\)|㈱|（有）|\(有\)|㈲)/g

// 波ダッシュ統一対象（~ U+007E, ～ U+FF5E, ∼ U+223C, 〜 U+301C, ˜ U+02DC, ⁓ U+2053）
const WAVE_DASH_RE = /[~～∼〜˜⁓]/g

// 品目表記ゆれ統一パターン
const CHINGENSAI_RE = /(青梗菜|チンゲンサイ|ちんげんさい|ちんげん菜|チンゲン菜)/g

// 空白除去パターン
const WHITESPACE_RE = /[\s\u3000]+/g

/** 品目名の表記ゆれを『チンゲン菜』に統一する（ARCHITECTURE.md §3.1・§3.2） */
export function normalizeItemName(rawItemName?: string | null): string {
  if (!rawItemName) return 'チンゲン菜'
  const normalized = rawItemName.normalize('NFKC').trim().replace(CHINGENSAI_RE, 'チンゲン菜')
  if (normalized.includes('チンゲン菜')) return 'チンゲン菜'
  return normalized
}

/** 規格の波ダッシュ（〜 U+301C）と括弧表記を表示用に整える */
export function normalizeSpecDisplay(rawSpec?: string | null): string {
  if (!rawSpec) return ''
  return rawSpec.normalize('NFKC').trim().replace(WAVE_DASH_RE, '〜')
}

/**
 * 注文キー構成要素の単一フィールド正規化（ARCHITECTURE.md §3.2 1〜5の規則）.
 */
export function normalizeKeyComponent(value?: string | null): string {
  if (!value) return ''
  let s = String(value).replace(CORPORATE_TITLES_RE, '')
  s = s.normalize('NFKC')
  s = s.replace(WAVE_DASH_RE, '〜')
  s = s.replace(CORPORATE_TITLES_RE, '')
  s = s.replace(CHINGENSAI_RE, 'チンゲン菜')
  s = s.replace(WHITESPACE_RE, '').toLowerCase()
  return s
}

/**
 * 第3.2章の仕様に基づき注文キー（`発注元|納品日|納品先|品目名|規格`）を生成する.
 */
export function generateOrderKey(params: {
  clientName?: string | null
  deliveryDate?: string | null
  destination?: string | null
  itemName?: string | null
  spec?: string | null
  duplicateIndex?: number
}): string {
  const normClient = normalizeKeyComponent(params.clientName)
  const normDate = normalizeKeyComponent(params.deliveryDate)
  const normDest = normalizeKeyComponent(params.destination)
  const normItem = normalizeKeyComponent(params.itemName || 'チンゲン菜')
  const normSpec = normalizeKeyComponent(params.spec)

  const baseKey = `${normClient}|${normDate}|${normDest}|${normItem}|${normSpec}`
  if ((params.duplicateIndex ?? 1) >= 2) {
    return `${baseKey}#${params.duplicateIndex}`
  }
  return baseKey
}

/**
 * 取引先・品目・規格から1ケースあたりの入数を判定する（チンゲン菜: 通常20/NSK24、他品目: 明示指定または品目標準）.
 */
export function determineUnitCount(
  clientName?: string | null,
  spec?: string | null,
  explicitUnitCount?: number | null,
  itemName?: string | null,
): number {
  if (explicitUnitCount && explicitUnitCount > 0) {
    return explicitUnitCount
  }
  const combined = `${clientName ?? ''} ${spec ?? ''}`.normalize('NFKC').toUpperCase()
  // specや生テキストに「入数24」「24入」「入数:30」「小コン 30」「30束入」等の記載があれば最優先で抽出
  const match = combined.match(/(?:入数|1箱|1ケース|小コン|大コン|青コン|茶コン|コンテナ)\s*[:：]?\s*(\d+)|(\d+)\s*(?:入|玉|束|本|パック|P)/i)
  if (match) {
    const n = Number(match[1] || match[2])
    if (Number.isFinite(n) && n > 0 && n <= 200) return n
  }

  if (
    combined.includes('ちばセット') ||
    combined.includes('千葉セット')
  ) {
    return 30
  }

  if (
    combined.includes('農業総合研究所') ||
    combined.includes('NSK') ||
    combined.includes('入数24') ||
    combined.includes('24入')
  ) {
    return 24
  }

  const normItem = (itemName ?? '').normalize('NFKC')
  if (normItem.includes('トマト')) {
    return 1 // トマトは通常1箱（ケース＝総数）
  }
  if (normItem.includes('ネギ') || normItem.includes('ねぎ')) {
    return 30 // 長ネギ標準30束
  }
  if (normItem.includes('白菜')) {
    return 6 // ミニ白菜標準6玉
  }

  // チンゲン菜標準
  return 20
}

/**
 * H列『数量/ケース』の固定書式文字列を生成する（ARCHITECTURE.md §3.1）.
 */
export function formatQuantityCaseText(totalPacks: number, cases: number, remainderPacks: number): string {
  return `総数${totalPacks}点（${cases}ケース＋端数${remainderPacks}点）`
}

/**
 * 第4.5章のルールに従いコンテナ種別を判定する.
 */
export function determineContainerType(
  clientName?: string | null,
  destination?: string | null,
): ContainerTypeLabel {
  const normDest = (destination ?? '').normalize('NFKC')
  const normClient = (clientName ?? '').normalize('NFKC').toUpperCase()

  if (normDest.includes('パルシステム')) return '青コン'
  if (normDest.includes('ちばコープ') || normDest.includes('グリンBOX') || normDest.includes('グリーンボックス')) {
    return '茶コン'
  }
  if (normClient.includes('農業総合研究所') || normClient.includes('NSK')) {
    return '農業総研専用折りたたみコンテナ'
  }
  if (normClient.includes('房総食料')) {
    return '房総青コン'
  }
  if (normClient.includes('勘兵衛')) {
    return '段ボール'
  }
  return '通常コンテナ'
}

/**
 * 第4.5章のルールに従い必要コンテナ箱数を計算する.
 */
export function calculateContainerBoxes(cases: number, remainderPacks: number): number {
  if (cases < 0) return 0
  return cases + (remainderPacks > 0 ? 1 : 0)
}

/**
 * 入数（20/24または品目別入数）および取引先ルールに基づき数量を検算・正規化する（ARCHITECTURE.md §4.1〜4.4）.
 */
export function validateAndComputeQuantities(params: {
  clientName?: string | null
  itemName?: string | null
  spec?: string | null
  totalPacks?: number | null
  cases?: number | null
  remainderPacks?: number | null
  unitCount?: number | null
  isCaseInput?: boolean
}): {
  totalPacks: number
  cases: number
  remainderPacks: number
  unitCount: number
  warningNote: string | null
} {
  const resolvedUnit = determineUnitCount(params.clientName, params.spec, params.unitCount, params.itemName)
  const normClient = (params.clientName ?? '').normalize('NFKC')
  let warningNote: string | null = null

  if (
    (normClient.includes('勘兵衛') || params.isCaseInput) &&
    (params.isCaseInput || ((params.totalPacks == null || params.totalPacks === 0) && (params.cases ?? 0) > 0))
  ) {
    const cVal = Math.trunc(params.cases != null && params.cases > 0 ? params.cases : (params.totalPacks ?? 0))
    const computedTotal = cVal * resolvedUnit
    return {
      totalPacks: computedTotal,
      cases: cVal,
      remainderPacks: 0,
      unitCount: resolvedUnit,
      warningNote: null,
    }
  }

  let totalPacks = params.totalPacks
  if (totalPacks == null) {
    const cVal = Math.trunc(params.cases ?? 0)
    const rVal = Math.trunc(params.remainderPacks ?? 0)
    totalPacks = cVal * resolvedUnit + rVal
  }

  const tVal = Math.max(0, Math.trunc(totalPacks))
  const expectedCases = Math.floor(tVal / resolvedUnit)
  const expectedRem = tVal % resolvedUnit

  if (params.cases != null && params.remainderPacks != null) {
    const printedTotal = Math.trunc(params.cases) * resolvedUnit + Math.trunc(params.remainderPacks)
    if (printedTotal !== tVal && !(normClient.includes('勘兵衛') && Math.trunc(params.cases) === tVal)) {
      warningNote = `【要確認】数量検算不一致: 総数${tVal}P ≠ ${params.cases}ケース×${resolvedUnit}＋端数${params.remainderPacks}P(${printedTotal}P)`
    }
  }

  return {
    totalPacks: tVal,
    cases: expectedCases,
    remainderPacks: expectedRem,
    unitCount: resolvedUnit,
    warningNote,
  }
}

/**
 * 同一伝票内で全く同じ注文キーが複数行ある場合のみ、2行目以降に `#2`, `#3` を付与する（ARCHITECTURE.md §3.2）.
 */
export function assignUniqueOrderKeys<
  T extends {
    client_name: string
    delivery_date: string
    destination: string
    item_name: string
    spec: string
    order_key: string
  },
>(items: T[]): T[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const baseKey = generateOrderKey({
      clientName: item.client_name,
      deliveryDate: item.delivery_date,
      destination: item.destination,
      itemName: item.item_name,
      spec: item.spec,
      duplicateIndex: 1,
    })
    const nextCount = (counts.get(baseKey) ?? 0) + 1
    counts.set(baseKey, nextCount)
    item.order_key = generateOrderKey({
      clientName: item.client_name,
      deliveryDate: item.delivery_date,
      destination: item.destination,
      itemName: item.item_name,
      spec: item.spec,
      duplicateIndex: nextCount,
    })
  }
  return items
}

/**
 * 第4.5章のルールに従い、納品先ごとに端数を切り上げたコンテナ集計を返す.
 */
export function buildContainerSummary(
  items: Pick<
    PipelineExtractedItem,
    'delivery_date' | 'destination' | 'container_type' | 'unit_count' | 'total_packs' | 'status'
  >[],
): ContainerSummaryItem[] {
  const grouped = new Map<string, { delivery_date: string; destination: string; container_type: ContainerTypeLabel; unit_count: number; total_packs: number }>()

  for (const item of items) {
    if (item.status === '取消' || item.total_packs <= 0) continue
    const k = `${item.delivery_date}||${item.destination}||${item.container_type}||${item.unit_count}`
    const existing = grouped.get(k)
    if (existing) {
      existing.total_packs += item.total_packs
    } else {
      grouped.set(k, {
        delivery_date: item.delivery_date,
        destination: item.destination,
        container_type: item.container_type,
        unit_count: item.unit_count,
        total_packs: item.total_packs,
      })
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => `${a.delivery_date}|${a.destination}`.localeCompare(`${b.delivery_date}|${b.destination}`, 'ja'))
    .map((g) => {
      const cases = Math.floor(g.total_packs / g.unit_count)
      const remainder_packs = g.total_packs % g.unit_count
      const boxes = calculateContainerBoxes(cases, remainder_packs)
      return {
        delivery_date: g.delivery_date,
        destination: g.destination,
        container_type: g.container_type,
        total_packs: g.total_packs,
        cases,
        remainder_packs,
        boxes,
      }
    })
}

/**
 * Google Drive URL または `drive:<ID>` 文字列からファイルIDを抽出する.
 */
export function extractGoogleDriveFileId(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileMatch?.[1]) return fileMatch[1]

  const idParamMatch = trimmed.match(/drive\.google\.com\/(?:open|uc)\?[^#]*id=([a-zA-Z0-9_-]+)/)
  if (idParamMatch?.[1]) return idParamMatch[1]

  if (trimmed.startsWith('drive:')) {
    const id = trimmed.slice('drive:'.length).trim()
    if (id) return id
  }

  return null
}

/**
 * Kojima-FAX (`drive_backup.py`) が発行した Google Drive URL (`https://drive.google.com/file/d/{id}/view...`)
 * を iframe 埋め込み可能な `/preview` URL に変換する（Cloudflare R2・Supabase Storage 不要）.
 */
export function toGoogleDrivePreviewUrl(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  const fileId = extractGoogleDriveFileId(trimmed)
  if (fileId) {
    return `https://drive.google.com/file/d/${fileId}/preview`
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed
  }

  return null
}

/**
 * Google Drive URL を別タブ閲覧用の `/view` URL に変換する.
 */
export function toGoogleDriveViewUrl(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  const fileId = extractGoogleDriveFileId(trimmed)
  if (fileId) {
    return `https://drive.google.com/file/d/${fileId}/view`
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  return null
}
