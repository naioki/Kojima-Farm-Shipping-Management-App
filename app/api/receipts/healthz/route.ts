import { GET as receiptsGET } from '@/app/api/receipts/route'

export const runtime = 'nodejs'

/**
 * Kojima-FAX のパイプラインURLに `.../api/receipts` が設定された場合の `/api/receipts/healthz` 互換エイリアス。
 */
export async function GET() {
  return receiptsGET()
}
