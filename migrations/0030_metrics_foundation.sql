-- ============================================================
-- 0030_metrics_foundation.sql
-- 評価指標（1注文あたり処理時間・ミス件数・事務作業時間・紙の卒業）の計測基盤。
-- すべて追加のみ（既存データは消さない）。冪等。
-- ============================================================

-- 1) 受注経路の詳細。orders.source（fax/email/portal/manual）は既存ロジックが依存するため
--    触らず、手入力（manual）の内訳＝電話・LINE・紙を別列で持つ。NULL は「不明（導入前の手入力）」。
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS intake_channel TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_intake_channel_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_intake_channel_check
      CHECK (intake_channel IS NULL OR intake_channel IN ('fax', 'email', 'portal', 'phone', 'line', 'paper', 'other'));
  END IF;
END $$;
UPDATE public.orders
   SET intake_channel = source
 WHERE intake_channel IS NULL AND source IN ('fax', 'email', 'portal');

-- 2) 承認時刻（処理時間 = 受信 → 承認 → 出荷 の計測用）。過去分は audit_log から補完。
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
UPDATE public.orders o
   SET approved_at = a.first_at
  FROM (
    SELECT entity_id, MIN(created_at) AS first_at
      FROM public.audit_log
     WHERE entity_type = 'orders' AND new_values ->> 'status' = 'approved'
     GROUP BY entity_id
  ) a
 WHERE o.id = a.entity_id AND o.approved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_approved_at ON public.orders(approved_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at);

-- 3) 操作ログ（事務作業時間の自動推定・現場観察の基盤）。
--    page_active: 画面を開いて実際に操作していた時間（ms）。action/error は今後の観察用。
CREATE TABLE IF NOT EXISTS public.ops_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  role       TEXT,
  path       TEXT NOT NULL,
  event      TEXT NOT NULL CHECK (event IN ('page_active', 'action', 'error')),
  name       TEXT,
  active_ms  INTEGER CHECK (active_ms IS NULL OR active_ms >= 0),
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_events_created ON public.ops_events(created_at);
CREATE INDEX IF NOT EXISTS idx_ops_events_user_created ON public.ops_events(user_id, created_at);

ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
-- 書き込みはサーバー（/api/ops-events、service_role）経由のみ。閲覧は管理者のみ。
DROP POLICY IF EXISTS admin_read ON public.ops_events;
CREATE POLICY admin_read ON public.ops_events FOR SELECT USING ((SELECT public.is_admin()));
