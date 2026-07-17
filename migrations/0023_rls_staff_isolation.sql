-- 0023: RLSのポータル分離（Issue#11 / セキュリティP0）。
-- 従来の staff_read/staff_rw 系は「認証済み全員」だったため、取引先ポータルの
-- ユーザー（Magic Link・auth.usersのみ、public.usersに行なし）も他社の注文・
-- 取引先一覧・荷姿の作業指示（原価に近い内部情報）を読める設計だった。
-- 「public.users に行がある＝社内ユーザー」を is_staff() として全内部テーブルを締める。
-- ポータルが正当に必要とするものは customer_id スコープの portal_own を追加。
-- 冪等（CREATE OR REPLACE / DROP POLICY IF EXISTS）。

-- ── 社内ユーザー判定 ──
-- public.users は admin/staff のみ（CHECK制約・自動insertトリガなし）。ポータル
-- 取引先ユーザーは auth.users にのみ存在するため、この判定が最も堅牢
-- （app_metadata.role の付与漏れにも影響されない）。
-- SECURITY DEFINER: users テーブル自身のRLSに依らず自分の行の存在を確認するため。
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()))
$$;
COMMENT ON FUNCTION public.is_staff() IS
  '社内ユーザー（admin/staff）判定。public.usersに行があるか。ポータル取引先はfalse。';
REVOKE ALL ON FUNCTION public.is_staff() FROM anon;

-- ── 内部テーブルの staff 系ポリシーを is_staff() へ差し替え ──
-- （0014のinitplan最適化に合わせ (select ...) 形式で書く）

-- customers: 他社の取引先情報はポータルに見せない
DROP POLICY IF EXISTS staff_read ON public.customers;
CREATE POLICY staff_read ON public.customers FOR SELECT USING ((SELECT public.is_staff()));

-- products: 【意図的に authenticated のまま】ポータルの「いつものセット」が
-- products!inner(name) をJOIN参照する。品名・単位は非機微。書き込みは admin のみ（既存）。

-- customer_product_rules: 内部は is_staff、ポータルは自社分のみ
DROP POLICY IF EXISTS staff_read ON public.customer_product_rules;
CREATE POLICY staff_read ON public.customer_product_rules FOR SELECT USING ((SELECT public.is_staff()));
DROP POLICY IF EXISTS portal_own ON public.customer_product_rules;
CREATE POLICY portal_own ON public.customer_product_rules FOR SELECT
  USING (customer_id = ((SELECT auth.jwt()) -> 'app_metadata' ->> 'customer_id')::uuid);

-- orders / order_items: portal_own（自社分）は既存。全件読みを社内限定に
DROP POLICY IF EXISTS staff_read ON public.orders;
CREATE POLICY staff_read ON public.orders FOR SELECT USING ((SELECT public.is_staff()));
DROP POLICY IF EXISTS staff_read ON public.order_items;
CREATE POLICY staff_read ON public.order_items FOR SELECT USING ((SELECT public.is_staff()));

-- delivery_destinations: 内部は is_staff、ポータルは自社の納入先のみ
DROP POLICY IF EXISTS staff_read ON public.delivery_destinations;
CREATE POLICY staff_read ON public.delivery_destinations FOR SELECT USING ((SELECT public.is_staff()));
DROP POLICY IF EXISTS portal_own ON public.delivery_destinations;
CREATE POLICY portal_own ON public.delivery_destinations FOR SELECT
  USING (customer_id = ((SELECT auth.jwt()) -> 'app_metadata' ->> 'customer_id')::uuid);

-- deliveries / delivery_events / lots（配送・トレサ。完全に内部）
DROP POLICY IF EXISTS staff_read   ON public.deliveries;
DROP POLICY IF EXISTS staff_insert ON public.deliveries;
DROP POLICY IF EXISTS staff_update ON public.deliveries;
CREATE POLICY staff_read   ON public.deliveries FOR SELECT USING ((SELECT public.is_staff()));
CREATE POLICY staff_insert ON public.deliveries FOR INSERT WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY staff_update ON public.deliveries FOR UPDATE
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS staff_read  ON public.delivery_events;
DROP POLICY IF EXISTS staff_write ON public.delivery_events;
CREATE POLICY staff_read  ON public.delivery_events FOR SELECT USING ((SELECT public.is_staff()));
CREATE POLICY staff_write ON public.delivery_events FOR INSERT WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS staff_read ON public.lots;
CREATE POLICY staff_read ON public.lots FOR SELECT USING ((SELECT public.is_staff()));

-- harvest_estimates（収穫見込み。内部）
DROP POLICY IF EXISTS staff_rw ON public.harvest_estimates;
CREATE POLICY staff_rw ON public.harvest_estimates FOR ALL
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

-- pack_configs / pack_config_photos（荷姿・作業指示。原価に近い内部情報）
DROP POLICY IF EXISTS staff_read ON public.pack_configs;
CREATE POLICY staff_read ON public.pack_configs FOR SELECT USING ((SELECT public.is_staff()));
DROP POLICY IF EXISTS staff_read ON public.pack_config_photos;
CREATE POLICY staff_read ON public.pack_config_photos FOR SELECT USING ((SELECT public.is_staff()));

-- print_jobs（印刷キュー。内部）
DROP POLICY IF EXISTS staff_read   ON public.print_jobs;
DROP POLICY IF EXISTS staff_insert ON public.print_jobs;
CREATE POLICY staff_read   ON public.print_jobs FOR SELECT USING ((SELECT public.is_staff()));
CREATE POLICY staff_insert ON public.print_jobs FOR INSERT WITH CHECK ((SELECT public.is_staff()));

-- company_settings は【対象外】: 0014の注記どおり別ツールが作成・管理しており（このアプリは
-- 参照コードなし）、USING(true) ポリシーを締めると外部ツールを壊す恐れがある。
-- Supabaseアドバイザ警告は残るが、対応は所有ツール側で行うこと（オーナー判断事項）。
