-- ============================================================
-- 0029_schema_completeness.sql
-- 0026 カラム群の厳格保証（未適用環境エラーの防止）
-- ============================================================

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS quantity_raw TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS bag_type TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS seal_text TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS has_seal BOOLEAN;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS daily_pack_sort_order INTEGER;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS snap_total_packs INTEGER;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_manual_modified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_new_addition BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS order_key TEXT;

ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS pack_sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS shipping_route_name TEXT;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS departure_time TEXT;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS default_container_type TEXT;
