import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeOrders } from '@/lib/gemini/analyze'
import { getStaffFeatures } from '@/lib/field/features'
import { parseSpreadsheetToText } from '@/lib/excel/parse'
import { buildClarificationQuestions } from '@/lib/orders/clarifications'

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
 * 管理者は常時可。スタッフは設定「STAFF_CAN_OCR」がONのときのみ可。
 * FAX画像/PDF/Excel/テキストをGeminiに通し、抽出明細と【AI質問カード（不明点・未登録店舗）】を決定論的に生成して返す。
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

  const role = profile?.role
  if (role !== 'admin') {
    const features = await getStaffFeatures()
    if (role !== 'staff' || !features.ocr) {
      return NextResponse.json({ error: 'OCRの利用が許可されていません' }, { status: 403 })
    }
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です' },
      { status: 400 },
    )
  }

  const { imageBase64, mimeType, fileName, text, clientNameHint, modelOverride } = parsed.data

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
    const result = await analyzeOrders(
      analyzeInput,
      'manual',
      undefined,
      clientNameHint,
      modelOverride,
    )

    // DBマスタと突合して、疑問点・未登録納入先の質問カードを自動生成
    const [custRes, destRes, prodRes] = await Promise.all([
      admin.from('customers').select('id, name').eq('is_active', true),
      admin
        .from('delivery_destinations')
        .select('id, customer_id, code, full_name')
        .eq('is_active', true),
      admin.from('products').select('id, name').eq('is_active', true),
    ])

    const clarifications = buildClarificationQuestions(
      result.orders ?? [],
      custRes.data ?? [],
      destRes.data ?? [],
      prodRes.data ?? [],
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
