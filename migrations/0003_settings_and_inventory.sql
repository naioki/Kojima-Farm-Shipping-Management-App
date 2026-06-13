-- ============================================================
-- 0003_settings_and_inventory.sql
--   - app_settings：設定画面から入力する運用設定／秘密情報の保管（admin限定RLS）
--     ※ 秘密情報をDBに置くのは Secret Manager より弱い。緩和策として admin限定RLS＋
--       画面では値を返さない（書き込み専用・"設定済み"表示のみ）＋サーバーのみ読む。
--   - products.stock_qty：在庫数（Laravel版 画面4の在庫管理に対応）
-- ============================================================

-- 設定キー・バリュー（is_secret=true は画面に値を返さない）
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  is_secret  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
-- admin のみ全操作（service_role は cron 取り込みで RLS をバイパスして読む）
CREATE POLICY admin_all ON app_settings FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 在庫数（商品マスタ）
ALTER TABLE products ADD COLUMN stock_qty NUMERIC NOT NULL DEFAULT 0;
