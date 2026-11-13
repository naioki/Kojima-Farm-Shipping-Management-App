import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingColumnError } from '@/lib/supabase/missing-column'
import { analyzeOrders, type ParsedOrder, type ParsedItem } from '@/lib/gemini/analyze'
import { preprocessFaxImage, preprocessFaxImageRotated180 } from '@/lib/ocr/preprocess'
import { matchProductName, type ProductCandidate } from '@/lib/matching/name-match'
import { buildCustomerHintText, type ParseHint } from '@/lib/ingestion/learning'
import { loadQuantityHistory } from '@/lib/orders/quantity-history'
import { detectQuantityAnomaly } from '@/lib/orders/quantity-anomaly'
import { decideReceiptApproval, isAutoApproveOn, parseThreshold } from '@/lib/ingestion/auto-approve'
import { matchEmailCustomer } from '@/lib/ingestion/match-customer'
import { getSetting } from '@/lib/settings'
import { shiftDateStr } from '@/lib/dates'
import { foldKana } from '@/lib/normalize/kana'
import { sendMultiChannelAlert } from '@/lib/notifications/multi-channel'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { INGEST_REVIEW_HOLD_KEY } from '@/lib/ingestion/review-hold'
import {
  calculateContainerBoxes,
  determineContainerType,
  determineHasCard,
  determineUnitCount,
  resolveContainerType,
  formatQuantityCaseText,
  generateOrderKey,
  type PipelineAlertItem,
  type PipelineExtractedItem,
  type PipelineSlipResult,
} from '@/lib/pipeline/schemas'

export type ProcessReceiptStatus =
  | 'approved'
  | 'pending_review'
  | 'not_order'
  | 'ai_failed'
  | 'skipped_no_content'

export interface ProcessReceiptOptions {
  /**
   * Kojima-FAX 等からマルチパートPOSTされた際のオンメモリ画像/PDFバッファ。
   * 原本保管は Kojima-FAX 側のローカルおよび Google Drive 自動保存（drive_backup.py）で完結しているため、
   * Cloud Run 側ではストレージへの再保存・再ダウンロードを行わず、オンメモリで直接 Gemini に渡す。
   */
  inMemoryBuffer?: Buffer | null
  inMemoryMimeType?: string | null
}

export interface ProcessReceiptResult {
  receiptId: string
  status: ProcessReceiptStatus
  orderCount: number
  error?: string
  /** Kojima-FAX (order_pipeline_service.py) 互換の構造化レスポンスデータ */
  slipData?: PipelineSlipResult
  loadedDynamicRulesCount?: number
  usedModel?: string
}

/** 法人格や空白を除いた正規化名（取引先名の名寄せ用）。 */
function normalizeOrgNameLocal(name: string): string {
  return foldKana(name.normalize('NFKC'))
    .replace(/農事組合法人|株式会社|有限会社|合同会社|（株）|\(株\)|㈱|（有）|\(有\)|㈲/g, '')
    .replace(/[\s　（）()]/g, '')
    .toLowerCase()
}

/** AIが抽出した customer_name から customers テーブルの id を名寄せ解決する。 */
function matchCustomerByName(
  rawCustomerName: string | null | undefined,
  customers: { id: string; name: string }[],
): string | null {
  if (!rawCustomerName) return null
  const target = normalizeOrgNameLocal(rawCustomerName)
  if (!target) return null

  const exact = customers.find((c) => normalizeOrgNameLocal(c.name) === target)
  if (exact) return exact.id

  const partial = customers.find((c) => {
    const cand = normalizeOrgNameLocal(c.name)
    return cand.length > 0 && (cand.includes(target) || target.includes(cand))
  })
  return partial?.id ?? null
}

/** OCRが読んだ届け先テキストを納入先（code/full_name/aliases）に名寄せ。無ければ null。 */
export function matchDestinationId(
  text: string | null | undefined,
  dests: { id: string; code: string | null; full_name: string; aliases: string[] | null }[],
): string | null {
  if (!text) return null
  // ひらがな/カタカナ差（「らでぃっしゅ」⇔「ラディッシュ」）を吸収して比較する
  const norm = (s: string) => foldKana(s.normalize('NFKC').toLowerCase().replace(/[\s　]/g, ''))
  const lower = norm(text)
  const isSampleQuery = lower.includes('サンプル')

  // 1. 完全一致（最優先）
  const exactHit = dests.find((d) => {
    const cands = [d.code, d.full_name, ...(d.aliases ?? [])]
      .filter((s): s is string => Boolean(s))
      .map(norm)
    return cands.some((c) => c === lower)
  })
  if (exactHit) return exactHit.id

  // 2. 部分一致（サンプル問い合わせならサンプル付き納入先を、通常ならサンプルなし納入先を優先）
  //    「岩槻」のような短い別名が、別取引先名を含む長い入力（例: らでぃっしゅぼーや岩槻ST）を
  //    誤って吸い込まないよう、「入力が候補を含む」方向は候補3文字以上に限定する。
  const isRadishQuery = lower.includes('ラディッシュ') || lower.includes('ボーヤ') || lower.includes('st')
  const isPalQuery = lower.includes('パルシステム') || lower.includes('パル')
  const partialHits = dests.filter((d) => {
    const cands = [d.code, d.full_name, ...(d.aliases ?? [])]
      .filter((s): s is string => Boolean(s))
      .map(norm)
    const fullNorm = norm(`${d.code ?? ''} ${d.full_name}`)
    const isDestRadish = fullNorm.includes('ラディッシュ') || fullNorm.includes('ボーヤ') || fullNorm.includes('st')
    const isDestPal = fullNorm.includes('パルシステム') || fullNorm.includes('パル')
    if (isRadishQuery && isDestPal) return false
    if (isPalQuery && isDestRadish) return false
    const isDestSample = fullNorm.includes('サンプル')
    if (isSampleQuery !== isDestSample) return false
    return cands.some((c) => c.includes(lower) || (c.length >= 3 && lower.includes(c)))
  })

  if (partialHits.length === 1 && partialHits[0]) return partialHits[0].id
  if (partialHits.length > 1) {
    if (isSampleQuery) {
      const sampleHit = partialHits.find((d) =>
        Boolean(
          d.code?.includes('サンプル') ||
          d.full_name.includes('サンプル') ||
          (d.aliases ?? []).some((a) => a.includes('サンプル')),
        ),
      )
      if (sampleHit) return sampleHit.id
    } else {
      const nonSampleHit = partialHits.find((d) =>
        !Boolean(
          d.code?.includes('サンプル') ||
          d.full_name.includes('サンプル') ||
          (d.aliases ?? []).some((a) => a.includes('サンプル')),
        ),
      )
      if (nonSampleHit) return nonSampleHit.id
    }
    return partialHits[0]?.id ?? null
  }

  return null
}

/** 現在日時を MM/dd HH:mm (JST) で返す（数量変更メモ用: ARCHITECTURE.md §3.3） */
function formatJstShortTimestamp(): string {
  const jst = new Date(Date.now() + 9 * 3600_000)
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(jst.getUTCDate()).padStart(2, '0')
  const hh = String(jst.getUTCHours()).padStart(2, '0')
  const mi = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

/** 印（受信票の要確認）に出す、利用者向けの注文状態名 */
const EXISTING_STATUS_JA: Record<string, string> = {
  pending_review: '承認待ち',
  approved: '承認済み',
  shipped: '出荷済み',
  invoiced: '請求済み',
}

/**
 * 受信レコードを Gemini で解析し、`orders` / `order_items` へ反映する。
 *
 * 【ARCHITECTURE.md Ver 4.1 設計思想の継承】
 * 1. Google Drive中継・クラウド二重保存の廃止：
 *    FAX原本は Linux FAXサーバー（Kojima-FAX `drive_backup.py`）が Google Drive に自動保存し、
 *    その閲覧URL（`source_file_url`）とPDFバイナリを直接送ってくるため、Cloud Run側ではオンメモリで解析する。
 * 2. 注文キー（`発注元|納品日|納品先|品目名|規格`）による一意特定と5つの更新判定ルール（§3.3）：
 *    - A. 新規
 *    - B. 再送・内容維持（現場操作列は絶対上書きしない）
 *    - C. 数量変更（`MM/dd HH:mm {旧総P}→{新総P}P` の数量変更メモ自動記録＋アラート生成）
 *    - D. 取消からの復活
 *    - E. 和郷園「週間マトリクス」の消滅・取消2段階ガード（明示的キャンセル記載がない行消滅は自動で取消にせず『要確認』にする）
 */
export async function processReceipt(
  receiptId: string,
  options?: ProcessReceiptOptions,
): Promise<ProcessReceiptResult> {
  const admin = createAdminClient()

  const { data: receipt, error: receiptErr } = await admin
    .from('order_receipts')
    .select('id, channel, r2_key, raw_payload, sender_date_key, customer_id, is_revision, status')
    .eq('id', receiptId)
    .maybeSingle()
  if (receiptErr) return await failReceipt(receiptId, `受信レコードの取得に失敗: ${receiptErr.message}`)

  if (!receipt || receipt.status !== 'pending_ai') {
    return { receiptId, status: 'skipped_no_content', orderCount: 0 }
  }

  const payload = (receipt.raw_payload ?? {}) as Record<string, unknown>
  const sourceFileUrl =
    (typeof payload['source_file_url'] === 'string' && payload['source_file_url']) ||
    (typeof receipt.r2_key === 'string' && receipt.r2_key.startsWith('http') ? receipt.r2_key : '') ||
    ''
  const sourceFileName =
    (typeof payload['filename'] === 'string' && payload['filename']) || 'fax_receipt.pdf'
  const senderNameHint =
    (typeof payload['sender_name'] === 'string' && payload['sender_name'].trim()) || null
  const senderFaxHint =
    (typeof payload['sender_fax'] === 'string' && payload['sender_fax'].trim()) || null

  let imageBuffer: Buffer | null = options?.inMemoryBuffer ?? null
  const inMemoryMimeType: string | null =
    options?.inMemoryMimeType ??
    (typeof payload['content_type'] === 'string' ? payload['content_type'] : null)
  let textContent: string | null = null
  let emailSubject: string | null = null
  let emailFrom: string | null = null

  // raw_payload に一時保持された base64 画像/PDFの復元（ai_failed からの手動再解析時用）
  if (!imageBuffer && typeof payload['file_base64'] === 'string' && payload['file_base64']) {
    try {
      imageBuffer = Buffer.from(payload['file_base64'], 'base64')
    } catch {
      imageBuffer = null
    }
  }

  if (payload) {
    const body = typeof payload['text'] === 'string' ? payload['text'] : null
    emailSubject = typeof payload['subject'] === 'string' ? payload['subject'] : null
    emailFrom = typeof payload['from'] === 'string' ? payload['from'] : null
    textContent = body != null ? (emailSubject ? `件名: ${emailSubject}\n\n${body}` : body) : null
  }

  if (!imageBuffer && !textContent) {
    return await failReceipt(receiptId, 'コンテンツが空（画像なし・テキストなし）')
  }

  // 全有効取引先を取得（FAX番号突合・メール突合・AI抽出 customer_name 名寄せに共用）
  const { data: allCustomers, error: allCustomersErr } = await admin
    .from('customers')
    .select('id, name, channel_identifiers')
    .eq('is_active', true)
  if (allCustomersErr) console.error('[process-receipt] 取引先一覧の取得に失敗:', allCustomersErr.message)
  const activeCustomers = (allCustomers ?? []) as {
    id: string
    name: string
    channel_identifiers: { fax?: string[]; email?: string[]; subject_keywords?: string[] } | null
  }[]

  // FAX番号または宛先帳登録名（sender_name）から取引先を特定
  let customerId = receipt.customer_id as string | null
  if (!customerId && receipt.channel === 'fax') {
    const faxNum =
      senderFaxHint?.replace(/[\s-]/g, '') ||
      (receipt.sender_date_key ? (receipt.sender_date_key.split('_')[0] ?? '') : '')
    if (faxNum) {
      const matched = activeCustomers.find((c) =>
        (c.channel_identifiers?.fax ?? []).some((f) => f.replace(/[\s-]/g, '') === faxNum),
      )
      customerId = matched?.id ?? null
    }
    if (!customerId && senderNameHint) {
      customerId = matchCustomerByName(senderNameHint, activeCustomers)
    }
  }

  // メールは送信元アドレス→件名キーワードの順で取引先を特定
  if (!customerId && receipt.channel === 'email') {
    customerId = matchEmailCustomer(
      emailFrom,
      emailSubject,
      activeCustomers.map((c) => ({
        id: c.id,
        channelIdentifiers: c.channel_identifiers,
      })),
    )
  }

  // 取引先別の学習ヒントを取得（snake_case -> camelCase 変換）
  let hintText = ''
  if (customerId) {
    const { data: hints, error: hintsErr } = await admin
      .from('customer_parse_hints')
      .select('raw_name, corrected_name, hit_count')
      .eq('customer_id', customerId)
      .order('hit_count', { ascending: false })
      .limit(30)
    if (hintsErr) console.error('[process-receipt] 学習ヒントの取得に失敗:', hintsErr.message)
    if (hints && hints.length > 0) {
      const parsedHints: ParseHint[] = hints.map((h) => ({
        rawName: h.raw_name as string,
        correctedName: h.corrected_name as string | null,
        hitCount: h.hit_count as number | undefined,
      }))
      hintText = buildCustomerHintText(parsedHints)
    }
  }

  // 画像前処理（PDFはGeminiが直接読めるためそのまま渡し、画像のみ前処理＋上下逆さま自動再試行）
  let imageBase64: string | undefined
  let mimeType: string | undefined
  let rawImageBufferForRotation: Buffer | null = null
  if (imageBuffer) {
    const isPdf =
      (inMemoryMimeType && inMemoryMimeType.includes('pdf')) ||
      (imageBuffer.length >= 4 &&
        imageBuffer[0] === 0x25 && // %
        imageBuffer[1] === 0x50 && // P
        imageBuffer[2] === 0x44 && // D
        imageBuffer[3] === 0x46) // F
    if (isPdf) {
      imageBase64 = imageBuffer.toString('base64')
      mimeType = 'application/pdf'
    } else {
      rawImageBufferForRotation = imageBuffer
      try {
        const pre = await preprocessFaxImage(imageBuffer)
        imageBase64 = pre.base64
        mimeType = pre.mimeType
      } catch {
        imageBase64 = imageBuffer.toString('base64')
        mimeType = inMemoryMimeType || 'image/png'
      }
    }
  }

  // Gemini 解析（指示書 v2.3 & ARCHITECTURE.md Ver 4.1 チンゲン菜特化 + ai_rules 動的注入）
  const matchedCustomerName = customerId
    ? activeCustomers.find((c) => c.id === customerId)?.name ?? senderNameHint
    : senderNameHint

  let parsedOrders: ParsedOrder[]
  let isOrder: boolean
  let skipReason: string | null = null
  let slipNo: string | null = null
  let isFullResendingMatrix = false
  let loadedDynamicRulesCount = 0
  let usedModel: string | undefined

  try {
    const res = await analyzeOrders(
      { imageBase64, mimeType, text: textContent ?? undefined },
      receipt.channel as string,
      hintText,
      matchedCustomerName,
    )
    isOrder = res.is_order
    parsedOrders = res.orders
    skipReason = res.skip_reason ?? null
    slipNo = res.slip_no ?? null
    isFullResendingMatrix = Boolean(res.is_full_resending_matrix)
    loadedDynamicRulesCount = res.applied_rules_count ?? 0
    usedModel = res.used_model

    // 180° 逆さまFAX対策（画像のみ）
    if (rawImageBufferForRotation && shouldRetryRotated180(parsedOrders)) {
      try {
        const rot = await preprocessFaxImageRotated180(rawImageBufferForRotation)
        const rotRes = await analyzeOrders(
          { imageBase64: rot.base64, mimeType: rot.mimeType, text: textContent ?? undefined },
          receipt.channel as string,
          hintText,
          matchedCustomerName,
        )
        if (rotRes.is_order && avgOrderConfidence(rotRes.orders) > avgOrderConfidence(parsedOrders)) {
          isOrder = rotRes.is_order
          parsedOrders = rotRes.orders
          skipReason = rotRes.skip_reason ?? null
          slipNo = rotRes.slip_no ?? slipNo
          isFullResendingMatrix = Boolean(rotRes.is_full_resending_matrix)
          imageBase64 = rot.base64
          mimeType = rot.mimeType
          payload['file_base64'] = rot.base64
          payload['content_type'] = rot.mimeType
        }
      } catch (rotErr) {
        // 回転再試行の失敗は初回結果を使って続行（失敗はログに残す）
        console.warn('[process-receipt] 画像の回転再試行に失敗。初回の解析結果を使います:', rotErr)
      }
    }
  } catch (e) {
    return await failReceipt(receiptId, `AIの読み取りに失敗しました（原因: ${e instanceof Error ? e.message : String(e)}）`)
  }

  // Kojima-FAX (`order_pipeline_service.py`) 互換の slipData を構築
  const slipData = buildPipelineSlipResult({
    isOrderFax: isOrder && parsedOrders.length > 0,
    skipReason,
    channel: receipt.channel as string,
    slipNo,
    isFullResendingMatrix,
    sourceFileName,
    sourceFileUrl,
    parsedOrders,
  })

  // Google Drive 原本URL（source_file_url）が確実に存在する場合のみ、DB肥大化を防ぐため file_base64 を除去する。
  // 万一 FAX機側の Drive アップロード遅延・未取得時は、原本閲覧（/api/receipts/[id]/original）フォールバックのために file_base64 を温存する。
  const cleanPayload: Record<string, unknown> = { ...payload }
  if (sourceFileUrl) {
    delete cleanPayload['file_base64']
  }
  cleanPayload['parsed_orders'] = parsedOrders
  cleanPayload['slip_data'] = slipData

  // 非注文（JA富里きゅうり・トマト出荷割振表、ししとう注文書、チラシ、空FAXなど）は注文を作らず終了
  if (!isOrder || parsedOrders.length === 0) {
    const { error: notOrderErr } = await admin
      .from('order_receipts')
      .update({
        customer_id: customerId,
        ocr_confidence: 1,
        status: 'not_order',
        error_message: skipReason ?? '注文外FAX（対象外品目または案内文書）のため自動スキップしました',
        raw_payload: cleanPayload,
      })
      .eq('id', receiptId)
    if (notOrderErr) console.error('[process-receipt] not_order ステータスの更新に失敗:', notOrderErr.message)
    return {
      receiptId,
      status: 'not_order',
      orderCount: 0,
      slipData,
      loadedDynamicRulesCount,
      usedModel,
    }
  }

  // 商品マスタと照合（「青梗菜 / チンゲン菜」を名寄せ解決）
  const { data: products, error: productsErr } = await admin
    .from('products')
    .select('id, name, unit, aliases, default_tax_rate, default_unit_price')
    .eq('is_active', true)
  if (productsErr) {
    return await failReceipt(receiptId, `商品マスタの取得に失敗: ${productsErr.message}`)
  }
  const productRows = (products ?? []) as {
    id: string
    name: string
    unit: string
    aliases: string[] | null
    default_tax_rate?: 8 | 10 | null
    default_unit_price?: number | null
  }[]
  const candidates: ProductCandidate[] = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
  }))
  const productById = new Map(productRows.map((p) => [p.id, p]))

  const [autoApproveEnabledRaw, thresholdRaw] = await Promise.all([
    getSetting('AUTO_APPROVE_ENABLED'),
    getSetting('AUTO_APPROVE_THRESHOLD'),
  ])
  // V5 ハイブリッド自動承認: 未設定の場合はデフォルトで ON にする（app_settings で 'off' 指定時のみ OFF）
  const autoApproveToggle =
    autoApproveEnabledRaw == null || autoApproveEnabledRaw.trim() === ''
      ? true
      : isAutoApproveOn(autoApproveEnabledRaw)
  // 自動承認ONでしきい値未設定の場合は 0.80（80%以上は自動確定、要確認のみバッジ表示）を既定とする
  const threshold =
    thresholdRaw && thresholdRaw.trim() !== ''
      ? parseThreshold(thresholdRaw)
      : autoApproveToggle
        ? 0.8
        : parseThreshold(thresholdRaw)

  // 全顧客分の納入先マスタ・荷姿マスタ・取引ルールマスタを一括取得（0026 未適用環境にも安全にフォールバック）
  const [allDestsRes, allPacksRes, allRulesRes] = await Promise.all([
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true),
    admin
      .from('pack_configs')
      .select('id, product_id, customer_id, label, base_per_selling, selling_unit_label')
      .eq('is_active', true),
    admin
      .from('customer_product_rules')
      .select('*'),
  ])
  if (allDestsRes.error) console.error('[process-receipt] 納入先マスタの取得に失敗:', allDestsRes.error.message)
  if (allPacksRes.error) console.error('[process-receipt] 荷姿マスタの取得に失敗:', allPacksRes.error.message)
  if (allRulesRes.error) console.error('[process-receipt] 取引ルールマスタの取得に失敗:', allRulesRes.error.message)

  const allDests = (allDestsRes.data ?? []) as {
    id: string
    customer_id: string
    code: string | null
    full_name: string
    aliases: string[] | null
  }[]
  const allPacks = (allPacksRes.data ?? []) as {
    id: string
    product_id: string
    customer_id: string | null
    label: string
    base_per_selling: number
    selling_unit_label: string
  }[]
  const allRules = (allRulesRes.data ?? []) as {
    id: string
    customer_id: string
    product_id: string
    packs_per_case?: number | null
    container_type?: string | null
    spec?: string | null
    label_spec?: string | null
    has_card?: boolean | null
    bag_type?: string | null
    has_seal?: boolean | null
    seal_text?: string | null
  }[]

  const createdOrderIds: string[] = []
  let anyPendingReview = false
  let minOverallConfidence = 1
  let firstResolvedCustomerId: string | null = customerId
  const changeAlerts: PipelineAlertItem[] = [...slipData.alerts]
  /**
   * 取り込み中の書き込み失敗（supabase は例外を投げず { error } を返す）。画面が無いので
   * console.error に残し、受信票を「要確認」にして error_message と alerts（受信箱・ビューアに出る）に記録する。
   */
  const ingestIssues: string[] = []
  /**
   * 保存の失敗ではないが、人の確認が要るため受信票を要確認に残す理由（受信箱の自動同期で消さない。
   * lib/ingestion/review-hold.ts）。例: 承認済みの注文に確認が必要な再送を反映した。
   */
  const reviewHoldReasons: string[] = []
  const noteReviewHold = (alertMessage: string) => {
    reviewHoldReasons.push(alertMessage)
    changeAlerts.push({
      alert_id: `ALT-${Date.now().toString(36).toUpperCase()}-H${reviewHoldReasons.length}`,
      created_at: formatJstShortTimestamp(),
      alert_type: '要確認',
      message: alertMessage,
      resolved: false,
    })
  }
  const noteIngestIssue = (logTag: string, err: { message?: string } | string | null | undefined, alertMessage: string) => {
    const detail = typeof err === 'string' ? err : (err?.message ?? 'unknown')
    console.error(`[process-receipt] ${logTag}:`, detail.slice(0, 300))
    ingestIssues.push(alertMessage)
    changeAlerts.push({
      alert_id: `ALT-${Date.now().toString(36).toUpperCase()}-${ingestIssues.length}`,
      created_at: formatJstShortTimestamp(),
      alert_type: '要確認',
      message: alertMessage,
      resolved: false,
    })
  }

  // ── ARCHITECTURE.md §3.3 & V5 明細行の更新判定ルール（A.新規 / B.再送維持 / C.数量変更 / D.取消復活 / E.和郷園消滅2段階ガード）──
  for (const po of parsedOrders) {
    const orderCustomerId =
      customerId ?? matchCustomerByName(po.customer_name, activeCustomers)
    if (!firstResolvedCustomerId && orderCustomerId) {
      firstResolvedCustomerId = orderCustomerId
    }

    const custDests = orderCustomerId
      ? allDests.filter((d) => d.customer_id === orderCustomerId)
      : []
    let destinationId = matchDestinationId(po.destination_name, custDests)
    if (!destinationId && po.destination_name && orderCustomerId) {
      // 納品先もAIが追加判別してくれるため、未登録の納入先は自動でマスタ追加して即時バインド
      try {
        // code は帳票・画面に表示される名称。切り詰めると「相模セ」のように途切れるため必ず全文を保存する。
        const { data: newDest, error: newDestErr } = await admin
          .from('delivery_destinations')
          .insert({
            customer_id: orderCustomerId,
            code: po.destination_name,
            full_name: po.destination_name,
            sort_order: (custDests.length + 1) * 10,
          })
          .select('id, code, full_name, aliases')
          .single()
        if (newDestErr) {
          // 納入先なしで続ける（注文は「納入先要確認」で残る）。登録できなかったことは受信票に残す
          noteIngestIssue(
            '未登録の納入先の自動登録に失敗',
            newDestErr,
            `納入先「${po.destination_name}」を自動登録できませんでした。取引先の納入先を確認してください`,
          )
        } else if (newDest) {
          destinationId = newDest.id
          custDests.push({ ...newDest, customer_id: orderCustomerId, aliases: [] })
          allDests.push({ ...newDest, customer_id: orderCustomerId, aliases: [] })
        }
      } catch (err) {
        noteIngestIssue(
          '未登録の納入先の自動登録で例外',
          err instanceof Error ? err.message : String(err),
          `納入先「${po.destination_name}」を自動登録できませんでした。取引先の納入先を確認してください`,
        )
      }
    }
    const needsDestination = custDests.length > 0 && destinationId === null

    type EnrichedItem = {
      parsed: ParsedItem
      matchedProduct: {
    id: string
    name: string
    unit: string
    default_tax_rate?: 8 | 10 | null
    default_unit_price?: number | null
  } | null
      matchedRuleId: string | null
      resolvedQty: number | null
      resolvedUnit: string
      resolvedPackConfigId: string | null
      needsPackConfig: boolean
      effectiveConfidence: number
      isFlagged: boolean
      orderKey: string
      quantityChangeMemo: string | null
      containerType: string
      quantityCaseText: string
      lineNote: string | null
      bagType: string | null
      hasSeal: boolean | null
      sealText: string | null
      hasCard: boolean | null
    }

    const enriched: EnrichedItem[] = []
    for (const it of po.items) {
      const m = matchProductName(it.product_name ?? it.raw_name, candidates)
      const matchedProduct = m.productId ? (productById.get(m.productId) ?? null) : null
      const matchedRule =
        orderCustomerId && matchedProduct
          ? allRules.find(
              (r) => r.customer_id === orderCustomerId && r.product_id === matchedProduct.id,
            ) ?? null
          : null

      let resolvedQty: number | null = null
      const resolvedUnit = it.unit || matchedProduct?.unit || 'P'
      let resolvedPackConfigId: string | null = null
      let needsPackConfig = false

      const unitCount = determineUnitCount(
        po.customer_name ?? matchedCustomerName ?? '',
        it.spec ?? matchedRule?.spec ?? '',
        it.packs_per_case ?? (matchedRule?.packs_per_case ? Number(matchedRule.packs_per_case) : undefined),
      )

      if (matchedProduct) {
        const applicablePacks = allPacks.filter(
          (p) =>
            p.product_id === matchedProduct.id &&
            (p.customer_id === orderCustomerId || p.customer_id === null),
        )
        const customerSpecific = applicablePacks.filter((p) => p.customer_id === orderCustomerId)
        const pool = customerSpecific.length > 0 ? customerSpecific : applicablePacks

        // 規格文字列または入数（20 / 24）が一致する pack_config を最優先で選択
        const specNorm = (it.spec ?? matchedRule?.spec ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
        const matchedPack =
          pool.find(
            (p) =>
              specNorm &&
              p.label.normalize('NFKC').toLowerCase().replace(/\s+/g, '') === specNorm,
          ) ??
          pool.find((p) => Number(p.base_per_selling) === unitCount) ??
          (pool.length === 1 ? pool[0] : undefined)

        const packsPerCaseForParse = matchedPack
          ? Number(matchedPack.base_per_selling)
          : unitCount

        const pq = parseQuantity(it.quantity, { packsPerCase: packsPerCaseForParse })
        if (pq.type === 'ok') {
          resolvedQty = pq.total.toNumber()
        } else if (pq.type === 'delete') {
          resolvedQty = 0
        } else {
          const fallbackNum = Number(it.quantity)
          resolvedQty = Number.isFinite(fallbackNum) && fallbackNum > 0 ? fallbackNum : null
          needsPackConfig = true
        }

        if (matchedPack) {
          resolvedPackConfigId = matchedPack.id
        } else if (applicablePacks.length > 0) {
          needsPackConfig = true
        }
      } else {
        const n = Number(it.quantity)
        resolvedQty = Number.isFinite(n) && n > 0 ? n : null
      }

      const hasReviewReason = Boolean(it.needs_review_reason && it.needs_review_reason.trim() !== '')
      const effectiveConfidence = hasReviewReason ? Math.min(it.confidence, 0.55) : it.confidence
      const isFlagged =
        m.needsConfirmation ||
        effectiveConfidence < 0.7 ||
        hasReviewReason ||
        needsPackConfig ||
        needsDestination ||
        Boolean(it.is_approximate) ||
        Boolean(it.is_handwritten_modified)

      const totalP = Math.max(0, Math.trunc(resolvedQty ?? (Number(it.quantity) || 0)))
      const cases = it.cases ?? Math.floor(totalP / unitCount)
      const remainder = it.remainder_packs ?? totalP % unitCount
      const quantityCaseText =
        it.quantity_case_text || formatQuantityCaseText(totalP, cases, remainder)
      const containerType = resolveContainerType({
        itemContainer: it.container_type,
        ruleContainer: matchedRule?.container_type,
        clientName: po.customer_name ?? matchedCustomerName ?? '',
        destinationName: po.destination_name,
      })

      // V5 パッキング資材: FAX記載値 → 取引ルール既定値の順でフォールバック
      const bagType = it.bag_type ?? matchedRule?.bag_type ?? null
      const sealText = it.seal_text ?? matchedRule?.seal_text ?? null
      const hasSeal =
        it.has_seal != null
          ? it.has_seal
          : matchedRule?.has_seal != null
            ? matchedRule.has_seal
            : Boolean(sealText)
      // サンプル注文判定: サンプルの場合は現場カード印刷なし（has_card: false）
      const isItemSample = Boolean(
        (po.destination_name || '').includes('サンプル') ||
        (it.note || '').includes('サンプル') ||
        (po.note || '').includes('サンプル') ||
        (sourceFileName || '').includes('サンプル') ||
        (slipData.source_file_name || '').includes('サンプル')
      )
      const hasCard = isItemSample
        ? false
        : determineHasCard({
            clientName: po.customer_name ?? matchedCustomerName,
            destinationName: po.destination_name,
            spec: it.spec,
            note: [it.note, po.note].filter(Boolean).join(' '),
            ruleHasCard: matchedRule?.has_card ?? null,
            explicitHasCard: it.has_card ?? null,
          })

      const orderKey =
        it.order_key ||
        generateOrderKey({
          clientName: po.customer_name ?? matchedCustomerName ?? '',
          deliveryDate: po.delivery_date ?? '',
          destination: po.destination_name ?? '',
          itemName: it.product_name ?? 'チンゲン菜',
          spec: it.spec ?? matchedRule?.spec ?? '',
        })

      const lineNoteParts: string[] = []
      if (isItemSample && !it.note?.includes('サンプル')) {
        lineNoteParts.push('【サンプル】カード無し')
      }
      if (it.is_new_addition) lineNoteParts.push('★新規追加')
      if (it.note) lineNoteParts.push(it.note)
      if (it.needs_review_reason) lineNoteParts.push(`⚠${it.needs_review_reason}`)
      if (needsDestination && po.destination_name) {
        lineNoteParts.push(`⚠納入先要確認(${po.destination_name})`)
      }

      // 単価・買値・金額は現場ボード・指示に絶対に含めない（AIルール・現場規約遵守）
      const safeLineNotes = lineNoteParts.filter(
        (p) => !p.includes('単価') && !p.includes('買値') && !p.includes('¥'),
      )

      enriched.push({
        parsed: it,
        matchedProduct,
        matchedRuleId: matchedRule?.id ?? null,
        resolvedQty,
        resolvedUnit,
        resolvedPackConfigId,
        needsPackConfig,
        effectiveConfidence,
        isFlagged,
        orderKey,
        quantityChangeMemo: null,
        containerType,
        quantityCaseText,
        lineNote: safeLineNotes.length > 0 ? safeLineNotes.join(' / ') : null,
        bagType,
        hasSeal,
        sealText,
        hasCard,
      })
    }

    // 既存注文（同一 customer_id + delivery_date + destination_id または同一伝票No）との差分チェック（再発防止・決定論的Upsert）
    type ExistingOrderRow = { id: string; status: string; note: string | null; destination_id?: string | null }
    type PrevItemRow = {
      id: string
      product_id?: string | null
      product_name: string
      quantity: number
      version?: number | null
      field_status?: string
      shipped_qty?: number | null
      field_note?: string | null
      is_manual_modified?: boolean
      snap_total_packs?: number | null
      daily_pack_sort_order?: number | null
    }
    let existingOrder: ExistingOrderRow | undefined
    let prevItems: PrevItemRow[] = []

    // ★ サンプル注文の精密判定（伝票番号連番のstartsWith('42')等の脆い誤判定は完全排除）
    const rawText = typeof payload['text'] === 'string' ? payload['text'] : ''
    const destFullName = custDests.find((d) => d.id === destinationId)?.full_name || ''
    const isIncomingSample = Boolean(
      (po.note || '').includes('サンプル') ||
      (po.destination_name || '').includes('サンプル') ||
      destFullName.includes('サンプル') ||
      (sourceFileName || '').includes('サンプル') ||
      (slipData.source_file_name || '').includes('サンプル') ||
      rawText.includes('サンプル依頼書') ||
      rawText.includes('サンプル') ||
      enriched.some((e) => (e.parsed.note || '').includes('サンプル'))
    )

    if (orderCustomerId && po.delivery_date) {
      const effectiveSlip = po.slip_no || slipNo

      // 同一顧客・同一出荷日の既存未キャンセル注文を取得（宛先誤読込修正・伝票No一致を漏らさず照合）
      const { data: candidateOrders, error: candidateErr } = await admin
        .from('orders')
        .select('id, status, note, destination_id')
        .eq('customer_id', orderCustomerId)
        .eq('delivery_date', po.delivery_date)
        .neq('status', 'cancelled')
        .limit(20)
      if (candidateErr) {
        // 読めないまま「既存なし」として新規作成に進むと注文が二重になる。取り込み失敗として後で再試行する
        console.error('[process-receipt] 既存注文の読み込みに失敗:', candidateErr.message.slice(0, 300))
        return await failReceipt(
          receiptId,
          `既存注文の読み込みに失敗したため取り込みを中断しました（自動で再試行します）: ${candidateErr.message}`,
        )
      }

      if (candidateOrders && candidateOrders.length > 0) {
        // 1. 完全一致: destination_id が一致し、かつサンプル種別も一致（サンプル注文は伝票Noが異なる別サンプルを上書きしない #11-04）
        existingOrder = candidateOrders.find((ord) => {
          const destMatches = destinationId ? ord.destination_id === destinationId : !ord.destination_id
          const isSample = Boolean((ord.note || '').includes('サンプル'))
          if (!destMatches || (isIncomingSample ? !isSample : isSample)) return false
          if (isIncomingSample && effectiveSlip && (ord.note || '').includes('伝票No:')) {
            return (ord.note || '').includes(`伝票No: ${effectiveSlip}`)
          }
          return true
        }) as ExistingOrderRow | undefined

        // 2. 伝票No一致: 宛先が異なっていても同一伝票Noの未着手注文があればバインド（宛先修正・更新）
        if (!existingOrder && effectiveSlip) {
          existingOrder = candidateOrders.find((ord) => {
            const hasSameSlip = (ord.note || '').includes(`伝票No: ${effectiveSlip}`)
            const isSample = Boolean((ord.note || '').includes('サンプル'))
            return (
              hasSameSlip &&
              !createdOrderIds.includes(ord.id) &&
              (isIncomingSample ? isSample : !isSample)
            )
          }) as ExistingOrderRow | undefined
        }

        // 3. 単一注文フォールバック: その出荷日に1件しかなく、今回の新FAXでもその出荷日の注文が1件のみの場合（BOX用↔ちばセット用の列修正等も引き継ぐ）
        const sameDateParsedCount = parsedOrders.filter((p) => p.delivery_date === po.delivery_date).length
        if (
          !existingOrder &&
          candidateOrders.length === 1 &&
          sameDateParsedCount === 1 &&
          candidateOrders[0] &&
          !createdOrderIds.includes(candidateOrders[0].id)
        ) {
          const onlyOne = candidateOrders[0]
          const isSample = Boolean((onlyOne.note || '').includes('サンプル'))
          if (isIncomingSample ? isSample : !isSample) {
            existingOrder = onlyOne as ExistingOrderRow
          }
        }
      }

      if (existingOrder) {
        const { data: pItems, error: pItemsErr } = await admin
          .from('order_items')
          .select('*')
          .eq('order_id', existingOrder.id)
        if (pItemsErr) {
          // 読めないまま「明細なし」として進むと、既存の明細と同じ品目を新規行で足して二重になる
          console.error('[process-receipt] 既存明細の読み込みに失敗:', pItemsErr.message.slice(0, 300))
          return await failReceipt(
            receiptId,
            `既存注文の明細の読み込みに失敗したため取り込みを中断しました（自動で再試行します）: ${pItemsErr.message}`,
          )
        }
        prevItems = (pItems ?? []) as PrevItemRow[]

        for (const eItem of enriched) {
          const targetName = eItem.matchedProduct?.name ?? eItem.parsed.product_name ?? 'チンゲン菜'
          const prev = prevItems.find(
            (p) =>
              (eItem.matchedProduct && p.product_id === eItem.matchedProduct.id) ||
              p.product_name === targetName ||
              (targetName === 'チンゲン菜' && (p.product_name === '青梗菜' || p.product_name === 'チンゲン菜')),
          )
          if (prev && eItem.resolvedQty != null && Number(prev.quantity) !== eItem.resolvedQty) {
            if (prev.is_manual_modified) {
              // GAS版 Q4: 手動修正済みの行はFAX再送で勝手に上書きせず保護
              const memo = `${formatJstShortTimestamp()} 手動修正保護(FAX:${eItem.resolvedQty}P / 現:${prev.quantity}P)`
              eItem.quantityChangeMemo = memo
              eItem.isFlagged = true
              eItem.lineNote = [eItem.lineNote, `⚠${memo}`].filter(Boolean).join(' / ')
              changeAlerts.push({
                alert_id: `ALT-${Date.now().toString(36).toUpperCase()}`,
                created_at: formatJstShortTimestamp(),
                alert_type: '要確認',
                message: `${po.customer_name ?? '取引先'} (${po.delivery_date} ${po.destination_name ?? ''}): 手動修正済みのためFAX再送(${eItem.resolvedQty}P)による上書きをブロックしました`,
                resolved: false,
              })
            } else {
              const oldP = Number(prev.quantity)
              const newP = eItem.resolvedQty
              const wasPacked = prev.field_status === 'packed' || prev.field_status === 'shipped'
              const delta = newP - oldP
              const memo = wasPacked
                ? `${formatJstShortTimestamp()} 🚨パック済(${oldP}P)→${newP}P(${delta > 0 ? `+${delta}P追加必要` : `${delta}P減`})`
                : `${formatJstShortTimestamp()} ${oldP}→${newP}P`
              eItem.quantityChangeMemo = memo
              eItem.isFlagged = true
              eItem.lineNote = [eItem.lineNote, `数量変更:${memo}`].filter(Boolean).join(' / ')
              changeAlerts.push({
                alert_id: `ALT-${Date.now().toString(36).toUpperCase()}`,
                created_at: formatJstShortTimestamp(),
                alert_type: '数量変更',
                message: `${po.customer_name ?? '取引先'} (${po.delivery_date} ${po.destination_name ?? ''}): ${oldP}P → ${newP}P${wasPacked ? `（パック済のため${delta > 0 ? `+${delta}P追加` : `${delta}P調整`}が必要）` : ''}`,
                resolved: false,
              })
            }
          }
        }
      }
    }

    // いつもと違う数量（過去90日の中央値の3倍以上/3分の1以下）。自動承認の方針（A案: 直結＋警告バッジ）は変えず、
    // 明細に要確認フラグとメモを付け、通知にも載せる（承認画面・スタッフ承認と同じ判定: lib/orders/quantity-anomaly）。
    if (orderCustomerId) {
      const pids = [...new Set(enriched.map((e) => e.matchedProduct?.id).filter(Boolean))] as string[]
      const history = await loadQuantityHistory(admin, [orderCustomerId], pids)
      for (const e of enriched) {
        if (!e.matchedProduct || e.resolvedQty == null) continue
        const { anomaly, usual } = detectQuantityAnomaly(e.resolvedQty, history.get(`${orderCustomerId}:${e.matchedProduct.id}`) ?? [])
        if (!anomaly || usual == null) continue
        const memo = `⚠いつもは${Math.round(usual)}${e.resolvedUnit ?? 'P'}前後（${anomaly === 'high' ? '多すぎ' : '少なすぎ'}）`
        e.isFlagged = true
        e.lineNote = [e.lineNote, memo].filter(Boolean).join(' / ')
        changeAlerts.push({
          alert_id: `ALT-${Date.now().toString(36).toUpperCase()}`,
          created_at: formatJstShortTimestamp(),
          alert_type: '数量確認',
          message: `${po.customer_name ?? '取引先'} (${po.delivery_date ?? ''}) ${e.matchedProduct.name}: ${e.resolvedQty} — ${memo}`,
          resolved: false,
        })
      }
    }

    // V5 A+B ハイブリッド自動承認判定:
    // - A案（完全直結＋警告バッジ）: 取引先・納品日・品目・数量(>0)が揃っていれば、再送・数量変更・概数・要確認メモがあっても
    //   自動で当日ボードへ直結（approved）し、カードに警告バッジ（is_flagged / 数量変更メモ）を表示する。
    // - B案（一部保留通知）: 取引先不明・納品日不明・品目不明・数量0以下など「ボードに載せられない致命的不明」のみ pending_review に保留する。
    const hasFatalAmbiguity =
      !orderCustomerId ||
      !po.delivery_date ||
      enriched.length === 0 ||
      enriched.some((e) => !e.matchedProduct || e.resolvedQty === null || e.resolvedQty <= 0)

    const approvalDecision = decideReceiptApproval({
      enabled: autoApproveToggle && !hasFatalAmbiguity,
      threshold: Math.min(threshold, 0.5),
      customerMatched: Boolean(orderCustomerId),
      deliveryDateKnown: Boolean(po.delivery_date),
      items: enriched.map((e) => ({
        confidence: hasFatalAmbiguity ? e.effectiveConfidence : Math.max(e.effectiveConfidence, threshold),
        productMatched: Boolean(e.matchedProduct),
      })),
    })

    let orderStatus: 'approved' | 'pending_review' =
      approvalDecision.action === 'auto_approve' ? 'approved' : 'pending_review'

    for (const e of enriched) {
      if (e.effectiveConfidence < minOverallConfidence) {
        minOverallConfidence = e.effectiveConfidence
      }
    }
    if (orderStatus === 'pending_review') anyPendingReview = true

    // 注文ヘッダー note（単数形: 0001_base_schema.sql 準拠）に伝票No・納入先・規格・入数・箱数・数量変更メモ等を集約
    const noteParts: string[] = []
    if (isIncomingSample && !noteParts.some((p) => p.includes('サンプル'))) {
      noteParts.push('【サンプル依頼】')
    }
    if (po.slip_no || slipNo) noteParts.push(`伝票No: ${po.slip_no || slipNo}`)
    if (po.note) noteParts.push(po.note)
    if (po.destination_name && !destinationId) {
      noteParts.push(`納入先(OCR): ${po.destination_name}`)
    }
    for (const e of enriched) {
      const it = e.parsed
      const meta: string[] = []
      if (it.spec) meta.push(`規格:${it.spec}`)
      if (e.quantityCaseText) meta.push(`数量表記:${e.quantityCaseText}`)
      if (e.containerType) meta.push(`容器:${e.containerType}`)
      if (it.box_count != null) meta.push(`箱数:${it.box_count}箱`)
      if (e.bagType) meta.push(`袋:${e.bagType}`)
      if (e.sealText) meta.push(`シール:${e.sealText}`)
      if (e.lineNote) meta.push(e.lineNote)
      if (meta.length > 0) {
        noteParts.push(meta.join(' / '))
      }
    }

    // 単価・買値・金額は注文ヘッダー備考にも絶対に含めない（AIルール・現場規約遵守）
    const safeNoteParts = noteParts.filter(
      (p) => !p.includes('単価') && !p.includes('買値') && !p.includes('¥'),
    )

    // 既存注文がある場合は重複INSERTせずインプレース更新（GAS版 注文キー冪等更新・二重ガード）
    let targetOrderId: string
    const insertedOrUpdatedItems: { id: string; product_id: string | null; quantity: number }[] = []

    if (existingOrder) {
      targetOrderId = existingOrder.id
      // 状態を書き換えてよいのは、取り込み前の状態が承認待ち（pending_review）か承認済み（approved）の注文だけ。
      // 承認済みの注文に「確認が必要」と判定された追加・訂正FAXが来たら、従来どおり承認待ちに戻す
      // （人が再承認するまで、書き換わった数量を出荷一覧に出さないための確認ゲート）。
      // 出荷済み・請求済みなどの注文の状態は、取り込みの判定で上書きしない（出荷・請求の進行を巻き戻さない）。
      const mayChangeStatus = existingOrder.status === 'pending_review' || existingOrder.status === 'approved'
      const updatePayload: Record<string, unknown> = {
        ...(mayChangeStatus ? { status: orderStatus } : {}),
        note: safeNoteParts.length > 0 ? safeNoteParts.join('\n') : existingOrder.note,
      }
      if (!mayChangeStatus && orderStatus === 'pending_review') {
        // 以前は承認待ちに戻して人に見せていた内容。状態は変えない代わりに受信票を要確認に残す
        noteReviewHold(
          `${po.delivery_date ?? ''}の注文（${EXISTING_STATUS_JA[existingOrder.status] ?? existingOrder.status}）: 確認が必要な内容の再送を反映しました。注文の内容をFAXと見比べてください`,
        )
      }
      if (destinationId && existingOrder.destination_id !== destinationId) {
        updatePayload.destination_id = destinationId
      }
      const { error: ordUpdErr } = await admin
        .from('orders')
        .update(updatePayload)
        .eq('id', targetOrderId)
      if (ordUpdErr) {
        noteIngestIssue(
          '既存注文のヘッダー更新に失敗',
          ordUpdErr,
          `${po.delivery_date ?? ''}の注文: 状態・備考・納入先の更新に失敗しました。注文の内容を確認してください`,
        )
      }
      createdOrderIds.push(targetOrderId)
      /** この注文で明細の更新・追加に失敗したか（失敗したら注文を要確認に戻して人が気づけるようにする） */
      let itemWriteFailed = false

      for (const e of enriched) {
        const targetName =
          e.matchedProduct?.name ?? e.parsed.product_name ?? e.parsed.raw_name ?? 'チンゲン菜'
        const prev = prevItems.find(
          (p) =>
            (e.matchedProduct && p.product_id === e.matchedProduct.id) ||
            p.product_name === targetName ||
            (targetName === 'チンゲン菜' && (p.product_name === '青梗菜' || p.product_name === 'チンゲン菜')),
        )

        if (prev) {
          if (prev.is_manual_modified) {
            // 手動修正保護された明細は数量・現場ステータスを維持し、line_note と is_flagged のみ追記
            const { error: flagErr } = await admin
              .from('order_items')
              .update({
                line_note: e.lineNote,
                is_flagged: true,
              })
              .eq('id', prev.id)
            if (flagErr) {
              noteIngestIssue(
                '手動修正済み明細への要確認メモの追記に失敗',
                flagErr,
                `${po.delivery_date ?? ''} ${targetName}: 手動修正済みの明細に最新FAXの内容（メモ）を書き込めませんでした。FAXと見比べてください`,
              )
            }
            insertedOrUpdatedItems.push({
              id: prev.id,
              product_id: e.matchedProduct?.id ?? null,
              quantity: Number(prev.quantity),
            })
            continue
          }

          const newQty = e.resolvedQty ?? 1
          const oldQty = Number(prev.quantity)
          const qtyChanged = oldQty !== newQty
          const wasPackedAndIncreased =
            qtyChanged &&
            newQty > oldQty &&
            (prev.field_status === 'packed' || prev.field_status === 'shipped')
          const preservedPartialQty = wasPackedAndIncreased
            ? oldQty
            : prev.shipped_qty && prev.shipped_qty > 0 && prev.shipped_qty < newQty
            ? prev.shipped_qty
            : null

          const baseUpdatePayload: Record<string, unknown> = {
            product_id: e.matchedProduct?.id ?? null,
            product_name: targetName,
            quantity: newQty,
            version: (Number(prev.version) || 1) + 1,
            quantity_raw: e.quantityCaseText || e.parsed.quantity,
            unit: e.resolvedUnit,
            pack_config_id: e.resolvedPackConfigId,
            rule_id: e.matchedRuleId,
            spec: e.parsed.spec ?? null,
            container_type: e.containerType,
            has_card: e.hasCard,
            line_note: e.lineNote,
            fraction_note:
              e.parsed.remainder_packs && e.parsed.remainder_packs > 0
                ? `端数${e.parsed.remainder_packs}P`
                : null,
            confidence: e.effectiveConfidence,
            is_flagged: e.isFlagged,
            // Case C (数量変更): 現場進捗を未完了に戻して欠品を防ぎつつ、既にパック済だった分は途中数(shipped_qty)として保持し「あと+〇〇P」を明確化
            ...(qtyChanged
              ? {
                  field_status: 'not_started',
                  shipped_qty: preservedPartialQty,
                }
              : {}),
          }
          const v5UpdatePayload: Record<string, unknown> = {
            ...baseUpdatePayload,
            bag_type: e.bagType,
            seal_text: e.sealText,
            has_seal: e.hasSeal,
            order_key: e.orderKey,
            ...(qtyChanged ? { snap_total_packs: null } : {}),
          }

          let { error: upErr } = await admin
            .from('order_items')
            .update(v5UpdatePayload)
            .eq('id', prev.id)
          if (upErr && isMissingColumnError(upErr)) {
            // 0026 未適用環境（列が無い）へのフォールバック。想定内なので記録しない
            const retry = await admin.from('order_items').update(baseUpdatePayload).eq('id', prev.id)
            upErr = retry.error
          }
          if (upErr) {
            itemWriteFailed = true
            noteIngestIssue(
              '既存明細の更新に失敗',
              upErr,
              `${po.delivery_date ?? ''} ${targetName}: 数量 ${oldQty}→${newQty} の更新に失敗しました。注文の数量を確認してください`,
            )
          } else {
            insertedOrUpdatedItems.push({
              id: prev.id,
              product_id: e.matchedProduct?.id ?? null,
              quantity: newQty,
            })
          }
        } else {
          // 既存注文への新規品目行の追加
          const baseInsertRow = {
            order_id: targetOrderId,
            product_id: e.matchedProduct?.id ?? null,
            product_name: targetName,
            quantity: e.resolvedQty ?? 1,
            quantity_raw: e.quantityCaseText || e.parsed.quantity,
            unit: e.resolvedUnit,
            pack_config_id: e.resolvedPackConfigId,
            rule_id: e.matchedRuleId,
            spec: e.parsed.spec ?? null,
            container_type: e.containerType,
            has_card: e.hasCard,
            line_note: e.lineNote,
            fraction_note:
              e.parsed.remainder_packs && e.parsed.remainder_packs > 0
                ? `端数${e.parsed.remainder_packs}P`
                : null,
            unit_price: e.matchedProduct?.default_unit_price ?? 0,
            tax_rate: e.matchedProduct?.default_tax_rate ?? 8,
            price_status: 'unpriced' as const,
            confidence: e.effectiveConfidence,
            is_flagged: e.isFlagged,
          }
          const v5InsertRow = {
            ...baseInsertRow,
            bag_type: e.bagType,
            seal_text: e.sealText,
            has_seal: e.hasSeal,
            is_new_addition: Boolean(e.parsed.is_new_addition),
            order_key: e.orderKey,
          }
          let { data: newIt, error: newItErr } = await admin
            .from('order_items')
            .insert(v5InsertRow)
            .select('id, product_id, quantity')
            .single()
          if (newItErr && isMissingColumnError(newItErr)) {
            // 0026 未適用環境（列が無い）へのフォールバック。想定内なので記録しない
            const retry = await admin
              .from('order_items')
              .insert(baseInsertRow)
              .select('id, product_id, quantity')
              .single()
            newIt = retry.data
            newItErr = retry.error
          }
          if (!newItErr && newIt) {
            insertedOrUpdatedItems.push({
              id: newIt.id as string,
              product_id: (newIt.product_id as string | null) ?? null,
              quantity: Number(newIt.quantity),
            })
          } else {
            // 明細を黙って欠落させない: 受信票と注文を要確認に残し、受信箱で人が気づけるようにする
            itemWriteFailed = true
            noteIngestIssue(
              '既存注文への新規明細の追加に失敗',
              newItErr ?? 'no row returned',
              `${po.delivery_date ?? ''} ${targetName} ${e.resolvedQty ?? ''}${e.resolvedUnit ?? ''}: 明細を注文に追加できませんでした。FAXを見て手で追加してください`,
            )
          }
        }
      }

      if (itemWriteFailed && orderStatus === 'approved') {
        // この注文の収穫タスクの同期（下）は行わない
        orderStatus = 'pending_review'
        // orderStatus（＝戻り値 result.status・受信票の扱い）は、状態を書き換えられない出荷済み・請求済みの
        // 注文でも pending_review にする（受信票は要確認に残る）。注文そのものの状態は別で、取り込み前が
        // 承認待ち・承認済みだった注文だけ承認待ちに戻す（そのまま現場ボードに出すと欠けた明細に誰も気づかないため）。
        // 元から出荷済み・請求済みの注文は状態を変えず、受信票の要確認（noteIngestIssue で error_message・alerts に
        // 記録済み）で人に知らせる。
        if (mayChangeStatus) {
          const { error: backErr } = await admin
            .from('orders')
            .update({ status: 'pending_review' })
            .eq('id', targetOrderId)
          if (backErr) {
            noteIngestIssue('明細の失敗後に注文を要確認へ戻せなかった', backErr, `${po.delivery_date ?? ''}の注文: 要確認に戻せませんでした。注文を確認してください`)
          }
        }
      }
      if (itemWriteFailed) anyPendingReview = true
    } else {
      const { data: order, error: orderErr } = await admin
        .from('orders')
        .insert({
          customer_id: orderCustomerId,
          destination_id: destinationId,
          delivery_date: po.delivery_date,
          delivery_date_source: po.delivery_date ? 'parsed' : null,
          source: receipt.channel,
          status: orderStatus,
          note: safeNoteParts.length > 0 ? safeNoteParts.join('\n') : null,
        })
        .select('id')
        .single()

      if (orderErr || !order) {
        return await failReceipt(receiptId, `注文作成失敗: ${orderErr?.message ?? 'unknown'}`)
      }
      targetOrderId = order.id as string
      createdOrderIds.push(targetOrderId)

      // order_items INSERT（0026 新カラム付き → 失敗時は 0001〜0025 互換カラムで自動フォールバック）
      const baseItemRows = enriched.map((e) => ({
        order_id: targetOrderId,
        product_id: e.matchedProduct?.id ?? null,
        product_name:
          e.matchedProduct?.name ?? e.parsed.product_name ?? e.parsed.raw_name ?? 'チンゲン菜',
        quantity: e.resolvedQty ?? 1,
        quantity_raw: e.quantityCaseText || e.parsed.quantity,
        unit: e.resolvedUnit,
        pack_config_id: e.resolvedPackConfigId,
        rule_id: e.matchedRuleId,
        spec: e.parsed.spec ?? null,
        container_type: e.containerType,
        has_card: e.hasCard,
        line_note: e.lineNote,
        fraction_note:
          e.parsed.remainder_packs && e.parsed.remainder_packs > 0
            ? `端数${e.parsed.remainder_packs}P`
            : null,
        unit_price: e.matchedProduct?.default_unit_price ?? 0,
        tax_rate: e.matchedProduct?.default_tax_rate ?? 8,
        price_status: 'unpriced' as const,
        confidence: e.effectiveConfidence,
        is_flagged: e.isFlagged,
      }))
      const v5ItemRows = enriched.map((e, idx) => ({
        ...baseItemRows[idx],
        bag_type: e.bagType,
        seal_text: e.sealText,
        has_seal: e.hasSeal,
        is_new_addition: Boolean(e.parsed.is_new_addition),
        order_key: e.orderKey,
      }))

      let { data: insertedItems, error: itemsErr } = await admin
        .from('order_items')
        .insert(v5ItemRows)
        .select('id, product_id, quantity')
      if (itemsErr) {
        const retry = await admin
          .from('order_items')
          .insert(baseItemRows)
          .select('id, product_id, quantity')
        insertedItems = retry.data
        itemsErr = retry.error
      }
      if (itemsErr) {
        // 巻き戻し（order_items は orders の ON DELETE CASCADE）
        const { error: rollbackErr } = await admin.from('orders').delete().eq('id', targetOrderId)
        if (rollbackErr) {
          console.error('[process-receipt] 巻き戻し（注文の削除）に失敗。明細の無い注文が残っています:', targetOrderId, rollbackErr.message)
          return await failReceipt(
            receiptId,
            `注文明細の保存失敗: ${itemsErr.message}（作りかけの注文の一部が残っている可能性があります。注文一覧で確認してください）`,
          )
        }
        return await failReceipt(receiptId, `注文明細の保存失敗: ${itemsErr.message}`)
      }
      for (const it of insertedItems ?? []) {
        insertedOrUpdatedItems.push({
          id: it.id as string,
          product_id: (it.product_id as string | null) ?? null,
          quantity: Number(it.quantity),
        })
      }
    }

    // 自動承認された場合は harvest_tasks（収穫タスク）も生成・同期（全品目「出荷日の前日に収穫・パック」の原則に従い task_date は delivery_date - 1日）
    if (orderStatus === 'approved' && po.delivery_date && insertedOrUpdatedItems.length > 0) {
      const harvestTaskDate = shiftDateStr(po.delivery_date, -1)
      const itemIdsForTasks = insertedOrUpdatedItems.map((it) => it.id)
      const HARVEST_ALERT = `${po.delivery_date}の注文: 収穫・パックの作業一覧を更新できませんでした。収穫一覧を確認してください`
      const { error: tasksDelErr } = await admin.from('harvest_tasks').delete().in('order_item_id', itemIdsForTasks)
      const taskRows = insertedOrUpdatedItems
        .filter((it) => Boolean(it.product_id))
        .map((it) => ({
          product_id: it.product_id as string,
          order_item_id: it.id,
          required_qty: Number(it.quantity),
          task_date: harvestTaskDate,
        }))
      if (tasksDelErr) {
        // 古いタスクを消せないまま作ると二重になるので作らない
        noteIngestIssue('harvest_tasks の削除に失敗', tasksDelErr, HARVEST_ALERT)
      } else if (taskRows.length > 0) {
        const { error: tasksErr } = await admin.from('harvest_tasks').insert(taskRows)
        if (tasksErr) noteIngestIssue('harvest_tasks の自動生成に失敗', tasksErr, HARVEST_ALERT)
      }
    }
  }

  // E. 最新FAX完全同期（スナップショット上書き）・空欄/旧伝票の自動整理エンジン（「新しくきたFAXが基本一番正しい」原則）
  // 週間マトリクス表・複数日付伝票・または伝票Noを持つ再送FAXを受信した際、
  // 対象日付範囲（matrixDates）および同一伝票No（effectiveSlipNo）の両方を網羅して照合し、
  // 最新FAXに記載のない古い未出荷注文（旧伝票Noの注文や前回誤読で別列に作られた不要行）を自動的にクリーンアップする。
  const matrixDates = [...new Set(parsedOrders.map((o) => o.delivery_date).filter(Boolean))] as string[]
  const effectiveSlipNo = slipNo || parsedOrders.find((o) => o.slip_no)?.slip_no || null
  const isIncomingSampleSlip = parsedOrders.some((o) =>
    Boolean((o.note || '').includes('サンプル') || (o.destination_name || '').includes('サンプル')),
  )

  if (firstResolvedCustomerId && (isFullResendingMatrix || effectiveSlipNo || matrixDates.length >= 1)) {
    const candidateOldOrdersMap = new Map<
      string,
      {
        id: string
        delivery_date: string | null
        destination_id: string | null
        note: string | null
        status: string
        order_items: {
          id: string
          field_status?: string
          shipped_qty?: number | null
          quantity?: number
          is_manual_modified?: boolean
        }[]
      }
    >()

    if (effectiveSlipNo) {
      const { data: rawSlipOrders, error: slipOrdersErr } = await admin
        .from('orders')
        .select('id, delivery_date, destination_id, note, status, order_items(id, field_status, shipped_qty, quantity, is_manual_modified)')
        .eq('customer_id', firstResolvedCustomerId)
        .neq('status', 'cancelled')
        .ilike('note', `%伝票No: ${effectiveSlipNo}%`)
      let slipOrders = rawSlipOrders ?? []
      if (slipOrdersErr) {
        const fbSlip = await admin
          .from('orders')
          .select('id, delivery_date, destination_id, note, status, order_items(id, field_status, shipped_qty, quantity)')
          .eq('customer_id', firstResolvedCustomerId)
          .neq('status', 'cancelled')
          .ilike('note', `%伝票No: ${effectiveSlipNo}%`)
        if (fbSlip.error) {
          noteIngestIssue(
            '同じ伝票Noの旧注文の読み込みに失敗（自動整理を行わない）',
            fbSlip.error,
            `伝票No ${effectiveSlipNo} の古い注文を読み込めず、自動整理できませんでした。同じ伝票の注文が重複していないか確認してください`,
          )
        }
        slipOrders = (fbSlip.data ?? []) as typeof slipOrders
      }
      for (const row of slipOrders ?? []) {
        candidateOldOrdersMap.set(row.id as string, row as never)
      }
    }

    if (matrixDates.length > 0 && !isIncomingSampleSlip && (isFullResendingMatrix || matrixDates.length >= 2)) {
      const { data: rawDateOrders, error: dateOrdersErr } = await admin
        .from('orders')
        .select('id, delivery_date, destination_id, note, status, order_items(id, field_status, shipped_qty, quantity, is_manual_modified)')
        .eq('customer_id', firstResolvedCustomerId)
        .neq('status', 'cancelled')
        .in('delivery_date', matrixDates)
      let dateOrders = rawDateOrders ?? []
      if (dateOrdersErr) {
        const fbDate = await admin
          .from('orders')
          .select('id, delivery_date, destination_id, note, status, order_items(id, field_status, shipped_qty, quantity)')
          .eq('customer_id', firstResolvedCustomerId)
          .neq('status', 'cancelled')
          .in('delivery_date', matrixDates)
        if (fbDate.error) {
          noteIngestIssue(
            '同じ日付の旧注文の読み込みに失敗（自動整理を行わない）',
            fbDate.error,
            `${matrixDates.join('・')}の古い注文を読み込めず、自動整理できませんでした。注文が重複していないか確認してください`,
          )
        }
        dateOrders = (fbDate.data ?? []) as typeof dateOrders
      }
      for (const row of dateOrders ?? []) {
        candidateOldOrdersMap.set(row.id as string, row as never)
      }
    }

    for (const ex of candidateOldOrdersMap.values()) {
      if (createdOrderIds.includes(ex.id)) continue

      // 通常注文FAXでサンプル注文を消さない（逆も同様）安全保護
      const isExSample = Boolean((ex.note || '').includes('サンプル'))
      if (isIncomingSampleSlip !== isExSample) continue

      const items = ex.order_items ?? []
      const hasManualModified = items.some((it) => Boolean(it.is_manual_modified))
      if (hasManualModified) continue

      const isUnstarted =
        items.length === 0 ||
        items.every(
          (it) =>
            (!it.field_status || it.field_status === 'not_started') &&
            (!it.shipped_qty || it.shipped_qty === 0),
        )

      if (isUnstarted) {
        // 未着手注文は「新しくきたFAXが基本一番正しい」の原則に従い、自動的にクリーンアップ（削除）
        console.log(
          `[process-receipt] 最新FAX完全同期により不要・消滅した未着手注文を自動整理: order_id=${ex.id}, date=${ex.delivery_date}`,
        )
        const itemIds = items.map((it) => it.id)
        const CLEANUP_ALERT = `${ex.delivery_date}の注文: 最新FAXに無い古い注文を自動整理できませんでした。重複していないか確認して手で片付けてください`
        let itemsCleared = true
        if (itemIds.length > 0) {
          // harvest_tasks は order_items の ON DELETE CASCADE でも消えるので、ここの失敗はログのみ
          const { error: htDelErr } = await admin.from('harvest_tasks').delete().in('order_item_id', itemIds)
          if (htDelErr) console.error('[process-receipt] 自動整理: harvest_tasks の削除に失敗（明細削除のカスケードで消える）:', htDelErr.message)
          const { error: itDelErr } = await admin.from('order_items').delete().in('id', itemIds)
          if (itDelErr) {
            itemsCleared = false
            noteIngestIssue('自動整理: 古い注文の明細の削除に失敗', itDelErr, CLEANUP_ALERT)
          }
        }
        if (itemsCleared) {
          const { error: ordDelErr } = await admin.from('orders').delete().eq('id', ex.id)
          if (ordDelErr) noteIngestIssue('自動整理: 古い注文の削除に失敗', ordDelErr, CLEANUP_ALERT)
        }
      } else {
        // 現場で作業中または完了済みの場合は、データ保護のため自動削除せず警告バッジを付与
        const guardNote = `【要確認】最新FAX(${effectiveSlipNo || '再送'})に記載なし（現場作業済のため保護）`
        const prevNote = ex.note
        const updatedNote = prevNote && !prevNote.includes(guardNote) ? `${prevNote}\n${guardNote}` : guardNote
        const { error: guardNoteErr } = await admin
          .from('orders')
          .update({ note: updatedNote })
          .eq('id', ex.id)
        // 警告バッジ（下の alerts）は受信票に残るので、注文の備考に書けなかったことはログに残す
        if (guardNoteErr) console.error('[process-receipt] 保護した注文への【要確認】備考の追記に失敗:', ex.id, guardNoteErr.message)
        changeAlerts.push({
          alert_id: `ALT-${Date.now().toString(36).toUpperCase()}`,
          created_at: formatJstShortTimestamp(),
          alert_type: '要確認',
          message: `${ex.delivery_date}の注文: 最新FAXに記載がありません（現場作業済のため保護）`,
          resolved: false,
        })
      }
    }
  }

  slipData.alerts = changeAlerts
  cleanPayload['slip_data'] = slipData
  cleanPayload['created_order_ids'] = createdOrderIds

  // 書き込みの失敗があった受信票は、自動承認でも「要確認」に残す（受信箱で人が気づけるように）。
  // 受信箱の自動同期（注文が承認済みなら受信票を approved にする）で消えないよう、明示の印を立てる。
  if (ingestIssues.length > 0 || reviewHoldReasons.length > 0) {
    anyPendingReview = true
    cleanPayload[INGEST_REVIEW_HOLD_KEY] = true
  } else {
    delete cleanPayload[INGEST_REVIEW_HOLD_KEY]
  }
  const finalReceiptStatus: 'pending_review' | 'approved' = anyPendingReview
    ? 'pending_review'
    : 'approved'

  // order_receipts 更新（代表 order_id として先頭を紐付け。inbox.ts の二重表示防止ルールに準拠して status を設定）
  const { error: finalUpdateErr } = await admin
    .from('order_receipts')
    .update({
      customer_id: firstResolvedCustomerId,
      order_id: createdOrderIds[0] ?? null,
      delivery_date: parsedOrders[0]?.delivery_date ?? null,
      ocr_confidence: minOverallConfidence,
      status: finalReceiptStatus,
      error_message:
        ingestIssues.length > 0
          ? `取り込み中に一部の保存に失敗しました: ${[...ingestIssues, ...reviewHoldReasons].join(' / ')}`.slice(0, 500)
          : reviewHoldReasons.length > 0
            ? `確認が必要です: ${reviewHoldReasons.join(' / ')}`.slice(0, 500)
            : null,
      raw_payload: cleanPayload,
    })
    .eq('id', receiptId)
  if (finalUpdateErr) {
    console.error('[process-receipt] order_receipts の完了更新に失敗:', finalUpdateErr.message)
  }

  // B案: 承認待ち（判別不能・必須項目欠落）または 数量変更アラートがあればマルチチャネル通知
  if (anyPendingReview || changeAlerts.length > 0) {
    const itemSummary = parsedOrders
      .flatMap((o) =>
        o.items.map(
          (i) =>
            `${o.destination_name ? `[${o.destination_name}] ` : ''}${i.product_name ?? i.raw_name} ${i.quantity}${i.unit ?? 'P'}`,
        ),
      )
      .slice(0, 6)
      .join('、')
    const alertMessages = changeAlerts.map((a) => `・[${a.alert_type}] ${a.message}`).join('\n')
    const notifyTitle = anyPendingReview
      ? '🚨 要確認FAX（未確定の注文があります）'
      : '⚠ 再送FAXによる数量変更・要確認通知'
    const notifyBody = [
      `チャネル: ${receipt.channel} / 件数: ${createdOrderIds.length}件 / 確信度: ${Math.round(minOverallConfidence * 100)}%`,
      itemSummary,
      alertMessages,
    ]
      .filter(Boolean)
      .join('\n')

    // notify() と sendMultiChannelAlert() の両方を呼ぶと LINE WORKS に同じ通知が2通届くため、
    // 送信先を広く持つ sendMultiChannelAlert（LINE WORKS / Discord / LINE / メール）に一本化する。
    await Promise.allSettled([
      sendMultiChannelAlert({
        title: notifyTitle,
        message: notifyBody,
        urgent: anyPendingReview,
        url: `/field/viewer/${receiptId}`,
      }),
    ])
  }

  return {
    receiptId,
    status: finalReceiptStatus,
    orderCount: createdOrderIds.length,
    slipData,
    loadedDynamicRulesCount,
    usedModel,
  }
}

/**
 * Gemini の `ParsedOrder[]` から `Kojima-FAX` (`order_pipeline_service.py`) および
 * `ARCHITECTURE.md` 第3章・第4章互換の `PipelineSlipResult` を構築する。
 */
export function buildPipelineSlipResult(params: {
  isOrderFax: boolean
  skipReason: string | null
  channel: string
  slipNo: string | null
  isFullResendingMatrix: boolean
  sourceFileName: string
  sourceFileUrl: string
  parsedOrders: ParsedOrder[]
}): PipelineSlipResult {
  const chUpper = (params.channel || 'FAX').toUpperCase()
  const sourceChannel =
    chUpper === 'FAX' || chUpper === 'LINE' || chUpper === 'DISCORD' ? chUpper : 'FAX'

  const items: PipelineExtractedItem[] = []
  const alerts: PipelineAlertItem[] = []
  let firstClientName = ''

  for (const po of params.parsedOrders) {
    const clientName = po.customer_name || '不明'
    if (!firstClientName && po.customer_name) firstClientName = po.customer_name
    const deliveryDate = po.delivery_date || ''
    const destination = po.destination_name || ''
    const orderSlipNo = po.slip_no || params.slipNo || ''

    for (const it of po.items) {
      const unitCount = determineUnitCount(clientName, it.spec ?? '', it.packs_per_case)
      const totalPacks = Math.max(0, Math.trunc(Number(it.quantity) || 0))
      const cases = it.cases ?? Math.floor(totalPacks / unitCount)
      const remainderPacks = it.remainder_packs ?? totalPacks % unitCount
      const quantityCaseText =
        it.quantity_case_text || formatQuantityCaseText(totalPacks, cases, remainderPacks)
      const containerType = determineContainerType(clientName, destination)
      const containerBoxes = it.explicit_cancel_in_slip
        ? 0
        : (it.box_count ?? calculateContainerBoxes(cases, remainderPacks))

      const status = it.explicit_cancel_in_slip
        ? '取消'
        : it.confidence < 0.7 || Boolean(it.needs_review_reason)
          ? '要確認'
          : '有効'

      const specialNotesParts: string[] = []
      if (it.needs_review_reason) specialNotesParts.push(it.needs_review_reason)
      if (it.note) specialNotesParts.push(it.note)
      const specialNotes = specialNotesParts.join(' / ')

      const orderKey =
        it.order_key ||
        generateOrderKey({
          clientName,
          deliveryDate,
          destination,
          itemName: it.product_name || 'チンゲン菜',
          spec: it.spec || '',
        })

      if (it.has_reply_required || specialNotes.includes('【要返答】')) {
        alerts.push({
          alert_id: `ALT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          created_at: formatJstShortTimestamp(),
          alert_type: '要返答',
          message: `${clientName} (${deliveryDate} ${destination}): ${specialNotes}`,
          resolved: false,
        })
      }

      items.push({
        slip_no: orderSlipNo,
        client_name: clientName,
        delivery_date: deliveryDate,
        destination,
        item_name: it.product_name || 'チンゲン菜',
        spec: it.spec || '',
        unit_count: unitCount,
        is_case_input: Boolean(it.is_case_input),
        total_packs: totalPacks,
        cases,
        remainder_packs: remainderPacks,
        quantity_case_text: quantityCaseText,
        status,
        special_notes: specialNotes,
        new_addition_mark: it.is_new_addition ? '★' : '',
        order_key: orderKey,
        source_file_url: params.sourceFileUrl,
        is_approximate: Boolean(it.is_approximate),
        is_handwritten_modified: Boolean(it.is_handwritten_modified),
        has_reply_required: Boolean(it.has_reply_required),
        explicit_cancel_in_slip: Boolean(it.explicit_cancel_in_slip),
        container_type: containerType,
        container_boxes: containerBoxes,
        confidence: it.confidence,
      })
    }
  }

  return {
    is_order_fax: params.isOrderFax,
    skip_reason: params.skipReason,
    source_channel: sourceChannel,
    client_name: firstClientName,
    slip_no: params.slipNo || '',
    is_full_resending_matrix: params.isFullResendingMatrix,
    source_file_id: '',
    source_file_name: params.sourceFileName,
    source_file_url: params.sourceFileUrl,
    items,
    alerts,
    ai_learned_rule_candidate: null,
  }
}

/**
 * 180° 逆さまFAXの自動再試行判定。
 * 注文ゼロ、または全明細の平均確信度が 0.5 未満のとき逆さまの可能性を疑う。
 */
function shouldRetryRotated180(orders: ParsedOrder[]): boolean {
  const items = orders.flatMap((o) => o.items)
  if (items.length === 0) return true
  return avgOrderConfidence(orders) < 0.5
}

function avgOrderConfidence(orders: ParsedOrder[]): number {
  const items = orders.flatMap((o) => o.items)
  if (items.length === 0) return 0
  return items.reduce((s, i) => s + i.confidence, 0) / items.length
}

/** G10: 指数バックオフで ai_failed に遷移（最大3回: 1分→5分→15分）。 */
async function failReceipt(receiptId: string, errorMessage: string): Promise<ProcessReceiptResult> {
  const admin = createAdminClient()
  const { data: cur } = await admin
    .from('order_receipts')
    .select('retry_count')
    .eq('id', receiptId)
    .maybeSingle()
  const nextCount = ((cur?.retry_count as number | undefined) ?? 0) + 1
  const backoffMin = nextCount === 1 ? 1 : nextCount === 2 ? 5 : 15
  const nextRetry =
    nextCount <= 3 ? new Date(Date.now() + backoffMin * 60_000).toISOString() : null

  const { error: failUpdateErr } = await admin
    .from('order_receipts')
    .update({
      status: 'ai_failed',
      retry_count: nextCount,
      next_retry_at: nextRetry,
      error_message: errorMessage.slice(0, 500),
    })
    .eq('id', receiptId)
  if (failUpdateErr) {
    console.error('[process-receipt] ai_failed ステータスの記録に失敗:', failUpdateErr.message)
  }

  return { receiptId, status: 'ai_failed', orderCount: 0, error: errorMessage }
}
