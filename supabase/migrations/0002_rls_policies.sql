-- =====================================================
-- Row Level Security ポリシー
-- =====================================================

-- テナントID取得ヘルパー関数（パフォーマンス最適化）
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$;

-- ① tenants: 自テナントのみ参照可能
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_self_access" ON tenants
  FOR SELECT USING (id = get_my_tenant_id());

-- ② users: 同テナントのみ参照可能
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_tenant_isolation" ON users
  USING (tenant_id = get_my_tenant_id());

-- ③ customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_tenant_isolation" ON customers
  USING (tenant_id = get_my_tenant_id());

-- ④ products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_tenant_isolation" ON products
  USING (tenant_id = get_my_tenant_id());

-- ⑤ unit_conversion_master
ALTER TABLE unit_conversion_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ucm_tenant_isolation" ON unit_conversion_master
  USING (tenant_id = get_my_tenant_id());

-- ⑥ magic_links
ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "magic_links_tenant_isolation" ON magic_links
  USING (tenant_id = get_my_tenant_id());

-- ⑦ order_verification_queue
ALTER TABLE order_verification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ovq_tenant_isolation" ON order_verification_queue
  USING (tenant_id = get_my_tenant_id());
-- フィールドワーカーは参照不可（バックオフィスのみ）
CREATE POLICY "ovq_backoffice_only" ON order_verification_queue
  FOR ALL USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'backoffice')
    AND tenant_id = get_my_tenant_id()
  );

-- ⑧ orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_tenant_isolation" ON orders
  USING (tenant_id = get_my_tenant_id());

-- ⑨ order_items
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_items_tenant_isolation" ON order_items
  USING (tenant_id = get_my_tenant_id());

-- ⑩ shipping_tasks: 全員参照可能、更新はフィールド・バックオフィス・管理者のみ
ALTER TABLE shipping_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shipping_tasks_tenant_read" ON shipping_tasks
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY "shipping_tasks_tenant_write" ON shipping_tasks
  FOR UPDATE USING (
    tenant_id = get_my_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'backoffice', 'field')
  );
CREATE POLICY "shipping_tasks_insert" ON shipping_tasks
  FOR INSERT WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'backoffice')
  );

-- ⑪ change_notifications
ALTER TABLE change_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "change_notifications_tenant_read" ON change_notifications
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY "change_notifications_insert" ON change_notifications
  FOR INSERT WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'backoffice')
  );
CREATE POLICY "change_notifications_ack" ON change_notifications
  FOR UPDATE USING (
    tenant_id = get_my_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'backoffice', 'field')
  );

-- ⑫ invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_tenant_isolation" ON invoices
  USING (tenant_id = get_my_tenant_id());

-- ⑬ invoice_items
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_isolation" ON invoice_items
  USING (
    invoice_id IN (
      SELECT id FROM invoices WHERE tenant_id = get_my_tenant_id()
    )
  );

-- ⑭ audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_tenant_isolation" ON audit_logs
  USING (tenant_id = get_my_tenant_id());

-- =====================================================
-- Supabase Realtime 設定
-- =====================================================
-- shipping_tasks と change_notifications をリアルタイム有効化
ALTER PUBLICATION supabase_realtime ADD TABLE shipping_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE change_notifications;
