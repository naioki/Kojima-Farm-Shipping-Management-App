-- ============================================================
-- 0026_v5_packing_shipping_inventory.sql
-- V5 現場最適化: 資材指示・パック作業順・便時間・コンテナ在庫・マルチ通知設定
-- すべて冪等 (IF NOT EXISTS) で安全に適用可能
-- ============================================================

-- 1. order_items テーブルの資材・作業順・スナップショット列
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS bag_type TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS seal_text TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS has_seal BOOLEAN;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS daily_pack_sort_order INTEGER;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS snap_total_packs INTEGER;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_manual_modified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_new_addition BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS order_key TEXT;

COMMENT ON COLUMN public.order_items.bag_type IS '袋種別 (印字/無地/FG/スタンドパック等)';
COMMENT ON COLUMN public.order_items.seal_text IS 'シール指示 (シールあり/生産者11:小島裕美等)';
COMMENT ON COLUMN public.order_items.daily_pack_sort_order IS '当日の管理者が指定したパック作業順';
COMMENT ON COLUMN public.order_items.snap_total_packs IS 'GAS版進捗確認時総P (数量変更検知用スナップショット)';
COMMENT ON COLUMN public.order_items.is_manual_modified IS '手動修正保護マーク (FAX再送による誤上書き防止)';
COMMENT ON COLUMN public.order_items.order_key IS '正規化注文キー (発注元|納品日|納品先|品目|規格)';

-- 2. delivery_destinations のデフォルト作業順・便・時間・コンテナ
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS pack_sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS shipping_route_name TEXT;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS departure_time TEXT;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS default_container_type TEXT;

-- 3. customer_product_rules の資材デフォルト設定
ALTER TABLE public.customer_product_rules ADD COLUMN IF NOT EXISTS bag_type TEXT;
ALTER TABLE public.customer_product_rules ADD COLUMN IF NOT EXISTS has_seal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.customer_product_rules ADD COLUMN IF NOT EXISTS seal_text TEXT;

-- 4. daily_container_inventory (冷蔵庫コンテナ在庫＆翌日自動引き継ぎ)
CREATE TABLE IF NOT EXISTS public.daily_container_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date DATE NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  stock_containers INTEGER NOT NULL DEFAULT 0,
  carryover_to_next_day INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_date, product_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_container_inv_date_prod
  ON public.daily_container_inventory (target_date, product_id);

ALTER TABLE public.daily_container_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all ON public.daily_container_inventory;
CREATE POLICY admin_all ON public.daily_container_inventory FOR ALL
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS staff_all ON public.daily_container_inventory;
CREATE POLICY staff_all ON public.daily_container_inventory FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 5. app_settings 初期値投入
INSERT INTO public.app_settings (key, value)
VALUES
  ('AUTO_APPROVE_ENABLED', 'on'),
  ('OVERDUE_ALERT_ENABLED', 'on'),
  ('NOTIFY_LINE_ENABLED', 'off'),
  ('NOTIFY_LINE_TOKEN', ''),
  ('NOTIFY_LINE_TO', ''),
  ('NOTIFY_LINEWORKS_ENABLED', 'off'),
  ('NOTIFY_LINEWORKS_WEBHOOK_URL', ''),
  ('NOTIFY_DISCORD_ENABLED', 'off'),
  ('NOTIFY_DISCORD_WEBHOOK_URL', ''),
  ('NOTIFY_EMAIL_ENABLED', 'off'),
  ('NOTIFY_EMAIL_TO', '')
ON CONFLICT (key) DO NOTHING;
