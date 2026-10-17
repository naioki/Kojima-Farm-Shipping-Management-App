/**
 * Kojima-FAX Ver 4.0 (`order_pipeline_service.py`) がデフォルトで送信する `/orders/ingest` エンドポイント。
 * `/api/receipts` と完全に同一の処理（オンメモリGemini解析＋Google Drive原本URL記録）を実行する。
 */
export { GET, POST, runtime, maxDuration } from '@/app/api/receipts/route'
