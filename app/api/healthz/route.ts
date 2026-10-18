import { GET as receiptsGET } from '@/app/api/receipts/route'

export const runtime = 'nodejs'

/**
 * Kojima-FAX / FAXsoft で URL に `.../api` が設定され、内部で `/healthz` を付加した場合の互換エイリアス。
 */
export async function GET() {
  return receiptsGET()
}
