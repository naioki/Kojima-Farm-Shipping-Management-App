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
 * FAX画像/PDF/Excel/テキストをGeminiに通し、抽出明細と【AI質問カード（不明点・未登録店舗）】を決定論的に生成して返す。
 * 万一 GEMINI_API_KEY 未設定または AI 過負荷時でも、テキスト・Excel・CSV入力は決定論的ローカルパーサーに自動フォールバックし業務を止めない。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile, error: profileErr } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) console.error('[app/api/ocr/analyze/route.ts] ロールの取得に失敗:', profileErr.message)

  const jwtRole = (user.app_metadata as { role?: string } | undefined)?.role
  const role = profile?.role ?? jwtRole
  if (role !== 'admin' && role !== 'staff' && !(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'OCRの利用が許可されていません' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です' },
      { status: 400 },
    )
  }

  const { imageBase64, mimeType, fileName, text, clientNameHint, modelOverride } = parsed.data

  // DBマスタを取得（名寄せ・質問カード生成・決定論的フォールバックで共用）
  const [custRes, destRes, prodRes] = await Promise.all([
    admin.from('customers').select('id, name').eq('is_active', true),
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true),
    admin.from('products').select('id, name, unit, aliases').eq('is_active', true),
  ])

  const customers = custRes.data ?? []
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
        text: sheetResult.text,
      }
    }
  }

  try {
    let result: OrdersResult
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

    const clarifications = buildClarificationQuestions(
      result.orders ?? [],
      customers,
      destinations,
      products,
    )

    return NextResponse.json({
      ...result,
      clarifications,
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
