import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeOrders, type ParsedOrder, type ParsedItem } from '@/lib/gemini/analyze'
import { preprocessFaxImage, preprocessFaxImageRotated180 } from '@/lib/ocr/preprocess'
import { matchProductName, type ProductCandidate } from '@/lib/matching/name-match'
import { buildCustomerHintText, type ParseHint } from '@/lib/ingestion/learning'
import { decideReceiptApproval, isAutoApproveOn, parseThreshold } from '@/lib/ingestion/auto-approve'
import { matchEmailCustomer } from '@/lib/ingestion/match-customer'
import { getSetting } from '@/lib/settings'
import { shiftDateStr } from '@/lib/dates'
import { foldKana } from '@/lib/normalize/kana'
import { notify } from '@/lib/notify'
import { sendMultiChannelAlert } from '@/lib/notifications/multi-channel'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import {
  calculateContainerBoxes,
  determineContainerType,
  determineUnitCount,
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
  const partialHits = dests.filter((d) => {
    const cands = [d.code, d.full_name, ...(d.aliases ?? [])]
      .filter((s): s is string => Boolean(s))
      .map(norm)
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
        }
      } catch {
        // 回転再試行の失敗は無視して初回結果を使う
      }
    }
  } catch (e) {
    return await failReceipt(receiptId, `Gemini解析失敗: ${e instanceof Error ? e.message : String(e)}`)
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
    .select('id, name, unit, aliases')
    .eq('is_active', true)
  if (productsErr) {
    return await failReceipt(receiptId, `商品マスタの取得に失敗: ${productsErr.message}`)
  }
  const productRows = (products ?? []) as {
    id: string
    name: string
    unit: string
    aliases: string[] | null
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
        const { data: newDest } = await admin
          .from('delivery_destinations')
          .insert({
            customer_id: orderCustomerId,
            code: po.destination_name,
            full_name: po.destination_name,
            sort_order: (custDests.length + 1) * 10,
          })
          .select('id, code, full_name, aliases')
          .single()
        if (newDest) {
          destinationId = newDest.id
          custDests.push({ ...newDest, customer_id: orderCustomerId, aliases: [] })
          allDests.push({ ...newDest, customer_id: orderCustomerId, aliases: [] })
        }
      } catch (err) {
        console.warn('[process-receipt] 自動納入先登録スキップ:', err)
      }
    }
    const needsDestination = custDests.length > 0 && destinationId === null

    type EnrichedItem = {
      parsed: ParsedItem
      matchedProduct: { id: string; name: string; unit: string } | null
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
      const containerType =
        it.container_type ||
        matchedRule?.container_type ||
        determineContainerType(po.customer_name ?? matchedCustomerName ?? '', po.destination_name)

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
      const hasCard =
        it.has_card != null
          ? it.has_card
          : isItemSample
            ? false
            : matchedRule?.has_card != null
              ? matchedRule.has_card
              : null

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
      const { data: candidateOrders } = await admin
        .from('orders')
        .select('id, status, note, destination_id')
        .eq('customer_id', orderCustomerId)
        .eq('delivery_date', po.delivery_date)
        .neq('status', 'cancelled')
        .limit(20)

      if (candidateOrders && candidateOrders.length > 0) {
        // 1. 完全一致: destination_id が一致し、かつサンプル種別も一致
        existingOrder = candidateOrders.find((ord) => {
          const destMatches = destinationId ? ord.destination_id === destinationId : !ord.destination_id
          const isSample = Boolean((ord.note || '').includes('サンプル'))
          return destMatches && (isIncomingSample ? isSample : !isSample)
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
        const { data: pItems } = await admin
          .from('order_items')
          .select('*')
          .eq('order_id', existingOrder.id)
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

    const orderStatus: 'approved' | 'pending_review' =
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
      const updatePayload: Record<string, unknown> = {
        status: orderStatus,
        note: safeNoteParts.length > 0 ? safeNoteParts.join('\n') : existingOrder.note,
      }
      if (destinationId && existingOrder.destination_id !== destinationId) {
        updatePayload.destination_id = destinationId
      }
      await admin
        .from('orders')
        .update(updatePayload)
        .eq('id', targetOrderId)
      createdOrderIds.push(targetOrderId)

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
            await admin
              .from('order_items')
              .update({
                line_note: e.lineNote,
                is_flagged: true,
              })
              .eq('id', prev.id)
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
          if (upErr) {
            // 0026 未適用環境へのフォールバック
            const retry = await admin.from('order_items').update(baseUpdatePayload).eq('id', prev.id)
            upErr = retry.error
          }
          if (upErr) {
            console.error('[process-receipt] 既存明細の更新に失敗:', upErr.message)
          }
          insertedOrUpdatedItems.push({
            id: prev.id,
            product_id: e.matchedProduct?.id ?? null,
            quantity: newQty,
          })
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
            unit_price: 0,
            tax_rate: 8,
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
          if (newItErr) {
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
          }
        }
      }
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
        unit_price: 0,
        tax_rate: 8,
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
        await admin.from('orders').delete().eq('id', targetOrderId)
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
      await admin.from('harvest_tasks').delete().in('order_item_id', itemIdsForTasks)
      const taskRows = insertedOrUpdatedItems
        .filter((it) => Boolean(it.product_id))
        .map((it) => ({
          product_id: it.product_id as string,
          order_item_id: it.id,
          required_qty: Number(it.quantity),
          task_date: harvestTaskDate,
        }))
      if (taskRows.length > 0) {
        const { error: tasksErr } = await admin.from('harvest_tasks').insert(taskRows)
        if (tasksErr) {
          console.error('[process-receipt] harvest_tasks の自動生成に失敗:', tasksErr.message)
        }
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
      const { data: slipOrders } = await admin
        .from('orders')
        .select('id, delivery_date, destination_id, note, status, order_items(id, field_status, shipped_qty, quantity, is_manual_modified)')
        .eq('customer_id', firstResolvedCustomerId)
        .neq('status', 'cancelled')
        .ilike('note', `%伝票No: ${effectiveSlipNo}%`)
      for (const row of slipOrders ?? []) {
        candidateOldOrdersMap.set(row.id as string, row as never)
      }
    }

    if (matrixDates.length > 0 && (isFullResendingMatrix || matrixDates.length >= 2 || effectiveSlipNo)) {
      const { data: dateOrders } = await admin
        .from('orders')
        .select('id, delivery_date, destination_id, note, status, order_items(id, field_status, shipped_qty, quantity, is_manual_modified)')
        .eq('customer_id', firstResolvedCustomerId)
        .neq('status', 'cancelled')
        .in('delivery_date', matrixDates)
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
        if (itemIds.length > 0) {
          await admin.from('harvest_tasks').delete().in('order_item_id', itemIds)
          await admin.from('order_items').delete().in('id', itemIds)
        }
        await admin.from('orders').delete().eq('id', ex.id)
      } else {
        // 現場で作業中または完了済みの場合は、データ保護のため自動削除せず警告バッジを付与
        const guardNote = `【要確認】最新FAX(${effectiveSlipNo || '再送'})に記載なし（現場作業済のため保護）`
        const prevNote = ex.note
        const updatedNote = prevNote && !prevNote.includes(guardNote) ? `${prevNote}\n${guardNote}` : guardNote
        await admin
          .from('orders')
          .update({ note: updatedNote })
          .eq('id', ex.id)
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
      error_message: null,
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

    await Promise.allSettled([
      notify({
        event: 'pending_review',
        level: anyPendingReview || receipt.is_revision ? 'warning' : 'info',
        title: notifyTitle,
        body: notifyBody,
        url: anyPendingReview ? '/admin/approvals' : '/field/shipments',
      }),
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
