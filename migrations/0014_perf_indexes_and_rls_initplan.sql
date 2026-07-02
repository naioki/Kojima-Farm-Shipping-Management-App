-- 0014: パフォーマンス改善（Supabaseアドバイザ対応）
-- 1) 外部キーの未インデックス25件にインデックスを追加（JOIN・削除カスケードの高速化）
-- 2) RLSポリシーの auth.*() 呼び出しを (select auth.*()) に書き換え
--    （行ごと評価 → クエリごと1回評価になる。auth_rls_initplan 警告14件の解消）
-- 注意: v_sales_* / v_ops_status / company_settings はこのアプリの管理外（別ツールが作成）のため触らない。

-- ========== 1) FKインデックス ==========
create index if not exists idx_app_settings_updated_by on app_settings(updated_by);
create index if not exists idx_audit_log_user_id on audit_log(user_id);
create index if not exists idx_customer_parse_hints_created_by on customer_parse_hints(created_by);
create index if not exists idx_customer_parse_hints_product_id on customer_parse_hints(product_id);
create index if not exists idx_customer_product_rules_product_id on customer_product_rules(product_id);
create index if not exists idx_delivery_notes_issued_by on delivery_notes(issued_by);
create index if not exists idx_harvest_estimates_created_by on harvest_estimates(created_by);
create index if not exists idx_harvest_tasks_order_item_id on harvest_tasks(order_item_id);
create index if not exists idx_harvest_tasks_product_id on harvest_tasks(product_id);
create index if not exists idx_invoice_items_order_item_id on invoice_items(order_item_id);
create index if not exists idx_invoices_created_by on invoices(created_by);
create index if not exists idx_order_items_pack_config_id on order_items(pack_config_id);
create index if not exists idx_order_items_priced_by on order_items(priced_by);
create index if not exists idx_order_items_product_id on order_items(product_id);
create index if not exists idx_order_items_rule_id on order_items(rule_id);
create index if not exists idx_order_receipts_customer_id on order_receipts(customer_id);
create index if not exists idx_order_receipts_order_id on order_receipts(order_id);
create index if not exists idx_order_receipts_parent_id on order_receipts(parent_id);
create index if not exists idx_orders_created_by on orders(created_by);
create index if not exists idx_price_rules_created_by on price_rules(created_by);
create index if not exists idx_price_rules_customer_id on price_rules(customer_id);
create index if not exists idx_price_rules_pack_config_id on price_rules(pack_config_id);
create index if not exists idx_spec_reports_handled_by on spec_reports(handled_by);
create index if not exists idx_spec_reports_product_id on spec_reports(product_id);
create index if not exists idx_spec_reports_reported_by on spec_reports(reported_by);

-- ========== 2) RLS initplan 最適化（意味は同一、評価回数のみ変わる） ==========
-- auth.role() = 'authenticated' 系（staff_read / staff_rw）
drop policy if exists staff_read on customers;
create policy staff_read on customers for select using ((select auth.role()) = 'authenticated');

drop policy if exists staff_read on products;
create policy staff_read on products for select using ((select auth.role()) = 'authenticated');

drop policy if exists staff_read on delivery_destinations;
create policy staff_read on delivery_destinations for select using ((select auth.role()) = 'authenticated');

drop policy if exists staff_read on customer_product_rules;
create policy staff_read on customer_product_rules for select using ((select auth.role()) = 'authenticated');

drop policy if exists staff_read on orders;
create policy staff_read on orders for select using ((select auth.role()) = 'authenticated');

drop policy if exists staff_read on order_items;
create policy staff_read on order_items for select using ((select auth.role()) = 'authenticated');

drop policy if exists staff_rw on harvest_estimates;
create policy staff_rw on harvest_estimates for all
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- auth.uid() 系
drop policy if exists staff_own on harvest_tasks;
create policy staff_own on harvest_tasks for select using (assigned_to = (select auth.uid()));

drop policy if exists staff_own_update on harvest_tasks;
create policy staff_own_update on harvest_tasks for update
  using (assigned_to = (select auth.uid()))
  with check (assigned_to = (select auth.uid()));

drop policy if exists staff_insert_own on spec_reports;
create policy staff_insert_own on spec_reports for insert
  with check (reported_by = (select auth.uid()));

drop policy if exists staff_select_own on spec_reports;
create policy staff_select_own on spec_reports for select
  using (reported_by = (select auth.uid()));

drop policy if exists user_self_read on users;
create policy user_self_read on users for select using (id = (select auth.uid()));

-- auth.jwt() 系（取引先ポータル）
drop policy if exists portal_own on orders;
create policy portal_own on orders for select
  using (customer_id = (nullif(((select auth.jwt()) -> 'app_metadata') ->> 'customer_id', ''))::uuid);

drop policy if exists portal_own on order_items;
create policy portal_own on order_items for select
  using (exists (
    select 1 from orders o
    where o.id = order_items.order_id
      and o.customer_id = (nullif(((select auth.jwt()) -> 'app_metadata') ->> 'customer_id', ''))::uuid
  ));
