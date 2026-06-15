import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { analyzeNormal } from '@/lib/gemini/analyze'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z
  .object({
    /** 画像（FAX/スキャン）の base64（data URL の接頭辞は除いたもの）。 */
    imageBase64: z.string().min(1).optional(),
    mimeType: z.string().optional(),
    /** メール本文などのテキスト。 */
    text: z.string().min(1).optional(),
    /** この解析だけに使う一回限りのプロンプト。設定は変更されない。 */
    promptOverride: z.string().optional(),
  })
  .refine((d) => Boolean(d.imageBase64 || d.text), {
    message: '画像またはテキストのいずれかが必要です',
  })

/**
 * 手動OCR解析（管理者専用）。
 * 取引先には公開しない（トークン消費抑制）。画像 or テキストを Gemini に通し、
 * 抽出した明細を返すだけ（DBには保存しない＝プレビュー）。
 * promptOverride を渡すとこの解析だけ別プロンプトを使う（保存はされない）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  // 管理者のみ（取引先・スタッフは不可）
  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: '手動OCRは管理者のみ利用できます' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です' },
      { status: 400 },
    )
  }

  const { imageBase64, mimeType, text, promptOverride } = parsed.data

  try {
    const items = await analyzeNormal(
      { imageBase64, mimeType, text },
      'manual',
      undefined,
      promptOverride,
    )
    return NextResponse.json({ items })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI解析に失敗しました'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
