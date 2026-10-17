import { NextRequest } from 'next/server'
import { GET as receiptsGET, POST as receiptsPOST } from '@/app/api/receipts/route'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Kojima-FAX のパイプラインURLに `.../api/receipts` が設定された場合の `/api/receipts/orders/ingest` 互換エイリアス。
 */
export async function GET() {
  return receiptsGET()
}

export async function POST(req: NextRequest) {
  return receiptsPOST(req)
}
