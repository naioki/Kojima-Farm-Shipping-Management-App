import { NextRequest } from 'next/server'
import { GET as receiptsGET, POST as receiptsPOST } from '@/app/api/receipts/route'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Kojima-FAX / FAXsoft で URL に `.../api` が設定された場合の互換エイリアス。
 * 接続テスト（GET）および注文投入（POST）を `/api/receipts` にバイパスする。
 */
export async function GET() {
  return receiptsGET()
}

export async function POST(req: NextRequest) {
  return receiptsPOST(req)
}
