import { GET as receiptsGET } from '@/app/api/receipts/route'

export const runtime = 'nodejs'

/**
 * Kojima-FAX Ver 4.0 (`order_pipeline_service.py` の `check_health()`) 用 `/healthz` エンドポイント。
 * `ARCHITECTURE.md` / `main.py` の「パス違いによる 404 Not Found 根絶」思想を継承。
 */
export async function GET() {
  return receiptsGET()
}
