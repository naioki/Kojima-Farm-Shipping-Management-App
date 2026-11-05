-- ============================================================
-- 0031_container_inventory_table.sql
-- 0026 の daily_container_inventory が本番に未適用だった（app_settings への仮保存で動いていた）ため作成する。
-- 0026 の staff_all ポリシー（authenticated なら誰でも可）は取引先ポータルのユーザーも通してしまうので、
-- 社内ユーザー（public.is_staff()）に限定して作り直す。冪等。
-- 仮保存（app_settings の v5_container_inv:*）は本番で0件だったため移し替え不要（2026-11 確認）。
-- ============================================================

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
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS staff_all ON public.daily_container_inventory;
CREATE POLICY staff_all ON public.daily_container_inventory FOR ALL
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));
