import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { purgeOldReceiptBase64 } from '@/lib/receipts/retention'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 7日（1週間）以上経過した order_receipts の PDF生データ（file_base64）を自動クリーンアップし、
 * Supabase DB容量を解放するCronエンドポイント。
 *
 * ※ テキスト本文、伝票番号、AI解析明細、注文履歴は永久温存し、容量の大きいPDFバイナリのみを消去します。
 */
export async function GET() {
  const admin = createAdminClient()
  const result = await purgeOldReceiptBase64(admin, 7)
  return NextResponse.json({
    ok: true,
    ...result,
    message: `7日経過したPDF原本データ ${result.purgedCount} 件を消去し、DB容量を解放しました`,
  })
}
