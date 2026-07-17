import 'server-only'
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStaffFeatures } from '@/lib/field/features'

export const runtime = 'nodejs'

/**
 * 手動OCR画面でのアップロード時、同じファイルが既に取り込み済み（FAX自動取込・過去の手動OCR）
 * でないかをMD5で確認する（Geminiを呼ぶ前に判定＝費用ゼロで「同じFAXを2回登録」を防ぐ）。
 * exact_hash は自動取込（lib/ingestion/poll-email.ts）と同じ「元ファイルそのもの」のMD5。
 * 画像はブラウザ側で圧縮される前の生バイトを渡すこと（圧縮後だとハッシュが一致しない）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/ocr/check-duplicate/route.ts] ロールの取得に失敗:', profileErr.message)
  const role = profile?.role
  if (role !== 'admin') {
    const features = await getStaffFeatures()
    if (role !== 'staff' || !features.ocr) {
      return NextResponse.json({ error: 'OCRの利用が許可されていません' }, { status: 403 })
    }
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const hash = crypto.createHash('md5').update(buf).digest('hex')

  const admin = createAdminClient()
  const { data: receipt } = await admin
    .from('order_receipts')
    .select('id, received_at, order_id, channel')
    .eq('exact_hash', hash)
    .maybeSingle()

  if (!receipt) return NextResponse.json({ duplicate: false })

  return NextResponse.json({
    duplicate: true,
    receivedAt: receipt.received_at,
    orderId: receipt.order_id,
    channel: receipt.channel,
  })
}
