import { NextRequest } from 'next/server'
import { GET as receiptsGET, POST as receiptsPOST } from '@/app/api/receipts/route'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Kojima-FAX Ver 4.0 (`order_pipeline_service.py`) がデフォルトで送信する `/orders/ingest` エンドポイント。
 * `/api/receipts` と完全に同一の処理（オンメモリGemini解析＋Google Drive原本URL記録）を実行する。
 */
export async function GET() {
  return receiptsGET()
}

export async function POST(req: NextRequest) {
  return receiptsPOST(req)
}
