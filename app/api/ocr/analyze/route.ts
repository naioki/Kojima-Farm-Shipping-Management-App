import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeOrders, type OrdersResult } from '@/lib/gemini/analyze'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { parseSpreadsheetToText } from '@/lib/excel/parse'
import { buildClarificationQuestions } from '@/lib/orders/clarifications'
import { parseNaturalOrderTextDeterministic } from '@/lib/orders/natural-parser'
import { getStaffFeatures } from '@/lib/field/features'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z
  .object({
    /** 画像（FAX/スキャン）またはPDFの base64（data URL の接頭辞は除いたもの）。 */
    imageBase64: z.string().min(1).optional(),
    /** image/png, image/jpeg, application/pdf 等。Gemini がネイティブに解釈する。 */
    mimeType: z.string().optional(),
    /** ファイル名（拡張子判定・Excel解析用・任意）。 */
    fileName: z.string().optional(),
    /** メール本文・クイック注文・ルール検証などのテキスト。 */
    text: z.string().min(1).optional(),
    /** 取引先名が事前に特定できている場合のヒント（任意）。 */
    clientNameHint: z.string().optional(),
    /** 一回限りのモデル指定（AIルール画面等でのモデル検証用・任意）。 */
    modelOverride: z.string().optional(),
  })
  .refine((d) => Boolean(d.imageBase64 || d.text), {
    message: '画像またはテキストのいずれかが必要です',
  })

/**
 * 手動OCR・クイック注文・新規注文スマート読取解析エンドポイント。
 * 管理者および社内スタッフ（public.users 登録ユーザー）が利用可能。
 * FAX画像/PDF/Excel/テキストをGeminiに通し、抽出明細と【AI質問カード（不明点・未登録店舗）】、
 * さらに該当日の既存出荷状況（差分比較用）を一括で返す。
 */
export async function POST(req: Request) {
  const [user, rawBody] = await Promise.all([
    getAuthedUser(),
    req.json().catch(() => null),
  ])
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  // ロール確認とDBマスタ取得を完全並列で1往復に集約（直列DB往復の遅延を削減）
  const [profileRes, custRes, destRes, prodRes] = await Promise.all([
    admin.from('users').select('role').eq('id', user.id).maybeSingle(),
    admin.from('customers').select('id, name, channel_identifiers').eq('is_active', true),
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true),
    admin.from('products').select('id, name, unit, aliases').eq('is_active', true),
  ])
  if (profileRes.error) console.error('[app/api/ocr/analyze/route.ts] ロールの取得に失敗:', profileRes.error.message)

  const jwtRole = (user.app_metadata as { role?: string } | undefined)?.role
  const role = profileRes.data?.role ?? jwtRole
  if (role !== 'admin' && role !== 'staff' && !(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'OCRの利用が許可されていません' }, { status: 403 })
  }
  // 現場スタッフは設定「現場スタッフの写真・FAX自動読取（OCR）を許可」がオンのときだけ（管理者は常に可）
  if (role !== 'admin' && !(await getStaffFeatures()).ocr) {
    return NextResponse.json({ error: '写真・FAXの読み取りは管理者が許可していません（設定 → 現場スタッフに任せること）' }, { status: 403 })
  }

  const { imageBase64, mimeType, fileName, text, clientNameHint, modelOverride } = parsed.data

  const customers = (custRes.data ?? []).map((c) => {
    const ch = (c as { channel_identifiers?: { aliases?: string[] } | null }).channel_identifiers
    return {
      id: c.id as string,
      name: c.name as string,
      aliases: Array.isArray(ch?.aliases) ? ch.aliases : undefined,
    }
  })
  const destinations = destRes.data ?? []
  const products = prodRes.data ?? []

  // Excel (.xlsx, .xls) または CSV の場合は、構造化テキストにデコードして Gemini へ渡す
  let analyzeInput: { imageBase64?: string; mimeType?: string; text?: string } = {
    imageBase64,
    mimeType,
    text,
  }

  const lowerName = (fileName ?? '').toLowerCase()
  const isExcelOrCsv =
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.csv') ||
    (mimeType && (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')))

  if (imageBase64 && isExcelOrCsv) {
    const sheetResult = parseSpreadsheetToText(imageBase64, fileName)
    if (sheetResult.isSpreadsheet && sheetResult.text) {
      analyzeInput = {
        text: text ? `${sheetResult.text}\n\n追加指示:\n${text}` : sheetResult.text,
      }
    }
  }

  try {
    let result: OrdersResult
    // ⚡ 短文テキストのみの入力で決定論的パーサーが取引先・数量を完全特定できる場合はLLM通信をバイパスして0.01秒で即返却
    const isShortTextOnly = !analyzeInput.imageBase64 && Boolean(analyzeInput.text && analyzeInput.text.trim().length <= 120)
    const fastDet = isShortTextOnly && analyzeInput.text
      ? parseNaturalOrderTextDeterministic(analyzeInput.text, { customers, destinations, products })
      : null
    const detFullyResolved =
      fastDet &&
      fastDet.is_order &&
      fastDet.orders.length > 0 &&
      fastDet.orders.every((o) => Boolean(o.customer_name) && o.items.length > 0 && o.items.every((it) => Number(it.quantity) > 0))

    if (detFullyResolved && fastDet) {
      result = fastDet
    } else {
      try {
        result = await analyzeOrders(
          analyzeInput,
          'manual',
          undefined,
          clientNameHint,
          modelOverride,
        )
      } catch (aiErr) {
        // テキスト入力またはExcel/CSV展開テキストがある場合は、Gemini未設定・503障害時でも決定論パーサーで即時救済する
        if (analyzeInput.text && analyzeInput.text.trim()) {
          console.warn('[api/ocr/analyze] Gemini解析失敗のため決定論的パーサーへフォールバック:', aiErr)
          result = parseNaturalOrderTextDeterministic(analyzeInput.text, {
            customers,
            destinations,
            products,
          })
        } else {
          throw aiErr
        }
      }
    }

    const clarifications = buildClarificationQuestions(
      result.orders ?? [],
      customers,
      destinations,
      products,
    )

    // 抽出された納品日群の既存出荷データを1クエリで一括取得（UI側で「新規 / 数量変更 / 取消(0P)」を即座に表示するため）
    const uniqueDates = Array.from(
      new Set(
        (result.orders ?? [])
          .map((o) => o.delivery_date)
          .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d))),
      ),
    )

    let existingShipments: Array<{
      order_id: string
      customer_id: string | null
      destination_id: string | null
      delivery_date: string
      total_quantity: number
    }> = []

    if (uniqueDates.length > 0) {
      try {
        const { data: existOrders } = await admin
          .from('orders')
          .select('id, customer_id, destination_id, delivery_date, order_items(quantity)')
          .in('delivery_date', uniqueDates)
          .neq('status', 'cancelled')

        if (existOrders) {
          existingShipments = existOrders.map((ord) => {
            const rawItems = (ord.order_items ?? []) as Array<{ quantity?: number | null }>
            const totalQty = rawItems.reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0)
            return {
              order_id: ord.id,
              customer_id: ord.customer_id ?? null,
              destination_id: ord.destination_id ?? null,
              delivery_date: ord.delivery_date ?? '',
              total_quantity: totalQty,
            }
          })
        }
      } catch (exErr) {
        console.warn('[api/ocr/analyze] 既存出荷照会スキップ:', exErr)
      }
    }

    return NextResponse.json({
      ...result,
      clarifications,
      existingShipments,
    })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const isOverload =
      raw.includes('503') ||
      raw.toLowerCase().includes('high demand') ||
      raw.toLowerCase().includes('unavailable')
    const message = isOverload
      ? 'AIが混雑しています。しばらく待ってから再試行してください。'
      : `AI解析に失敗しました（${raw}）`
    return NextResponse.json({ error: message }, { status: isOverload ? 503 : 502 })
  }
}
