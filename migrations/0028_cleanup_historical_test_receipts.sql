-- ============================================================
-- 0028_cleanup_historical_test_receipts.sql
-- 過去の開発テスト時に未確定・AI失敗のまま残存したテスト受信データを dismissed（アーカイブ済み）に一括整理
-- これにより、収穫ボードや集計画面で「未確定・要確認のFAXが21件あります」と出続けるバグを完全解消する
-- ============================================================

UPDATE public.order_receipts
SET status = 'dismissed'
WHERE status IN ('unmatched', 'ai_failed')
  AND created_at < NOW() - INTERVAL '1 day';
