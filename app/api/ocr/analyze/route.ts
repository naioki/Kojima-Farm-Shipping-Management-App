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
    /** メール本文などのテキスト。 */
    text: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.imageBase64 || d.text), {
    message: '画像またはテキストのいずれかが必要です',
  })

/**
 * 手動OCR解析（社内のみ）。
 * 管理者は常時可。スタッフは設定「STAFF_CAN_OCR」がONのときのみ可（既定OFF）。
 * 取引先には公開しない（トークン消費抑制）。画像/PDF or テキストを Gemini に通し、
 * 抽出した明細を返すだけ（DBには保存しない＝プレビュー）。
 * promptOverride を渡すとこの解析だけ別プロンプトを使う（保存はされない）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  // 管理者は常時可。スタッフはフラグONのときのみ。取引先（portal）は不可。
  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
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

  const { imageBase64, mimeType, text } = parsed.data

  try {
    const result = await analyzeOrders({ imageBase64, mimeType, text }, 'manual')
    return NextResponse.json(result)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    // Gemini 過負荷（503）は一時的。ユーザーに再試行を促す。
    const isOverload = raw.includes('503') || raw.toLowerCase().includes('high demand') || raw.toLowerCase().includes('unavailable')
    const message = isOverload
      ? 'AIが混雑しています。しばらく待ってから再試行してください。'
      : 'AI解析に失敗しました'
    return NextResponse.json({ error: message }, { status: isOverload ? 503 : 502 })
  }
}
