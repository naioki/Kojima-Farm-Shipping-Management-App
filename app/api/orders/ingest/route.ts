import { NextRequest } from 'next/server'
import { GET as receiptsGET, POST as receiptsPOST } from '@/app/api/receipts/route'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * `/api/orders/ingest` 互換エイリアスエンドポイント。
 */
export async function GET() {
  return receiptsGET()
}

export async function POST(req: NextRequest) {
  return receiptsPOST(req)
}
