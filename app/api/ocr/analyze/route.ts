import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { analyzeOrders } from '@/lib/gemini/analyze'
import { getStaffFeatures } from '@/lib/field/features'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z
  .object({
    /** 画像（FAX/スキャン）またはPDFの base64（data URL の接頭辞は除いたもの）。 */
    imageBase64: z.string().min(1).optional(),
    /** image/png, image/jpeg, application/pdf 等。Gemini がネイティブに解釈する。 */
    mimeType: z.string().optional(),
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
 * 手動OCR・クイック注文・AIルール動作テスト解析エンドポイント（社内のみ）。
 * 管理者は常時可。スタッフは設定「STAFF_CAN_OCR」がONのときのみ可（既定OFF）。
 * 画像/PDF or テキストを Gemini v2.3（+ ai_rules 動的注入）に通し、抽出した明細と使用モデル名を返す。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
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

  const { imageBase64, mimeType, text, clientNameHint, modelOverride } = parsed.data

  try {
    const result = await analyzeOrders(
      { imageBase64, mimeType, text },
      'manual',
      undefined,
      clientNameHint,
      modelOverride,
    )
    return NextResponse.json(result)
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
