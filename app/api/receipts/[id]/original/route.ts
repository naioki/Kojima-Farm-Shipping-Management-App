import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { getReceiptSignedUrl } from '@/lib/r2'

export const runtime = 'nodejs'

/**
 * 受信原本（FAX画像・メール添付）の一時署名URLへリダイレクト（社内ユーザー専用）。
 * R2 の認証情報をクライアントに晒さず、検証画面・出荷一覧から原本を確認できるようにする。
 * staff も許可する（出荷一覧の原本直リンク・Issue#5。users テーブルに行がある社内ロールのみで、
 * ポータル取引先ユーザーは users に行が無く profile が取れないため弾かれる）。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin' && profile?.role !== 'staff')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { data: receipt, error } = await supabase
    .from('order_receipts')
    .select('r2_key')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!receipt?.r2_key) return NextResponse.json({ error: '原本がありません' }, { status: 404 })

  try {
    const url = await getReceiptSignedUrl(receipt.r2_key)
    return NextResponse.redirect(url)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
