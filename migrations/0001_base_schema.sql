-- ============================================================
-- 0001_base_schema.sql — 基盤10テーブル
-- ============================================================
-- 前提メモ（重要）:
--   本リポジトリには着手時点で migrations が存在しなかったため、features.md が
--   「既存」と呼ぶ10テーブルをここで新規定義する。カラム型は tax.md / structure.md /
--   features.md の記述に厳密に合わせる。features.md の ALTER 群（新規カラム）は
--   0002 で追加する（「既存テーブルへの追加」という設計意図を保つため分離）。
--
-- 規約:
--   - 金額は DECIMAL(14,2)（tax.md）
--   - tax_rate は 8 か 10 のみ（CHECK 制約・tax.md）
--   - subtotal / tax_amount / line_total は GENERATED 列（tax.md）
--     ※ Postgres は生成列が別の生成列を参照できないため、subtotal の式を
--       tax_amount / line_total にインライン展開する（規約の意図は保持）
--   - 全テーブル RLS 有効化＋ admin ポリシー同時作成（security.md）
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- updated_at 自動更新トリガ
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- JWT から admin 判定（ポリシーで再利用）
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', FALSE);
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 1. users（auth.users に対するプロフィール。role を保持）
-- ------------------------------------------------------------
CREATE TABLE users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 2. customers（取引先）
-- ------------------------------------------------------------
CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  name_kana       TEXT,
  closing_rule    TEXT NOT NULL DEFAULT 'month_end',  -- 締め（請求期間決定・tax.md）
  invoice_reg_num TEXT,                                -- 適格請求書発行事業者登録番号
  payment_terms   TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 3. products（商品マスタ）
-- ------------------------------------------------------------
CREATE TABLE products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  name_kana          TEXT,
  aliases            TEXT[] NOT NULL DEFAULT '{}',     -- 名寄せ（features §4）
  unit               TEXT NOT NULL DEFAULT '個',
  default_tax_rate   SMALLINT NOT NULL DEFAULT 8 CHECK (default_tax_rate IN (8, 10)),
  -- ↑ マスタ既定。計算には使わない（tax.md：注文時の order_items.tax_rate を使う）
  container_capacity NUMERIC,                          -- 総数→コンテナ分解（features §8）
  default_unit_price NUMERIC(14, 2),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 4. orders（受注ヘッダー）
-- ------------------------------------------------------------
CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  source        TEXT NOT NULL CHECK (source IN ('fax', 'email', 'portal', 'manual')),
  status        TEXT NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('pending_review', 'approved', 'shipped', 'invoiced', 'cancelled')),
  order_date    DATE NOT NULL DEFAULT current_date,
  delivery_date DATE,
  note          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_delivery ON orders(delivery_date);
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 5. order_items（受注明細・税率冗長保持・生成列）
-- ------------------------------------------------------------
CREATE TABLE order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,                          -- 注文時スナップショット
  quantity     NUMERIC(14, 2) NOT NULL CHECK (quantity >= 0),
  unit         TEXT NOT NULL DEFAULT '個',
  unit_price   NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  tax_rate     SMALLINT NOT NULL CHECK (tax_rate IN (8, 10)),  -- 注文時確定（tax.md）
  subtotal     NUMERIC(14, 2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED,
  tax_amount   NUMERIC(14, 2) GENERATED ALWAYS AS
                 (ROUND(ROUND(quantity * unit_price, 2) * tax_rate / 100.0, 2)) STORED,
  line_total   NUMERIC(14, 2) GENERATED ALWAYS AS
                 (ROUND(quantity * unit_price, 2)
                  + ROUND(ROUND(quantity * unit_price, 2) * tax_rate / 100.0, 2)) STORED,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE TRIGGER trg_order_items_updated BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 6. harvest_tasks（収穫タスク＝必要数。見込みは harvest_estimates と分離）
-- ------------------------------------------------------------
CREATE TABLE harvest_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id),
  order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
  required_qty  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  task_date     DATE NOT NULL,
  assigned_to   UUID REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started', 'harvesting', 'packing', 'completed', 'delayed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_harvest_tasks_date ON harvest_tasks(task_date);
CREATE INDEX idx_harvest_tasks_assignee ON harvest_tasks(assigned_to);
CREATE TRIGGER trg_harvest_tasks_updated BEFORE UPDATE ON harvest_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 7. invoices（請求ヘッダー。税率別合計を保持・tax.md）
-- ------------------------------------------------------------
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT NOT NULL UNIQUE,                -- YYYYMM-0001（欠番なし）
  customer_id     UUID NOT NULL REFERENCES customers(id),
  billing_month   TEXT NOT NULL,                       -- 'YYYY-MM'
  issue_date      DATE,
  due_date        DATE,
  invoice_reg_num TEXT,                                -- 発行時スナップショット
  subtotal_8      NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- 8% 対象 税抜合計
  tax_8           NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- 消費税 8%
  subtotal_10     NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- 10% 対象 税抜合計
  tax_10          NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- 消費税 10%
  total_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- 税込総額
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'finalized', 'sent', 'paid', 'void')),
  pdf_r2_key      TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_month ON invoices(billing_month);
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 8. invoice_items（請求明細＝order_items のスナップショット。税率冗長保持）
-- ------------------------------------------------------------
CREATE TABLE invoice_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id),
  product_name  TEXT NOT NULL,
  quantity      NUMERIC(14, 2) NOT NULL,
  unit          TEXT NOT NULL DEFAULT '個',
  unit_price    NUMERIC(14, 2) NOT NULL,
  tax_rate      SMALLINT NOT NULL CHECK (tax_rate IN (8, 10)),   -- 冗長保持（tax.md）
  subtotal      NUMERIC(14, 2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED,
  tax_amount    NUMERIC(14, 2) GENERATED ALWAYS AS
                  (ROUND(ROUND(quantity * unit_price, 2) * tax_rate / 100.0, 2)) STORED,
  line_total    NUMERIC(14, 2) GENERATED ALWAYS AS
                  (ROUND(quantity * unit_price, 2)
                   + ROUND(ROUND(quantity * unit_price, 2) * tax_rate / 100.0, 2)) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ------------------------------------------------------------
-- 9. audit_log（変更履歴・Undoの基盤。7年保存・tax.md）
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type    TEXT NOT NULL,                        -- 'order_items' / 'invoices' ...
  entity_id      UUID NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'undo')),
  changed_fields TEXT[],
  old_values     JSONB,
  new_values     JSONB,
  user_id        UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id, created_at DESC);

-- ------------------------------------------------------------
-- 10. invoice_counters（請求書番号の欠番なし採番・tax.md）
-- ------------------------------------------------------------
CREATE TABLE invoice_counters (
  month    TEXT PRIMARY KEY,                           -- 'YYYYMM'
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- 同時実行に強い採番。UPSERT で行をロックしつつ連番を返す（gaps なし）
CREATE OR REPLACE FUNCTION get_next_invoice_number(p_month TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  INSERT INTO invoice_counters(month, last_seq)
  VALUES (p_month, 1)
  ON CONFLICT (month)
  DO UPDATE SET last_seq = invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS — 全テーブル有効化＋ admin 全権ポリシー（security.md）
--   service_role キーは RLS をバイパスするため、cron/集計はサーバ側 admin.ts で実行。
-- ============================================================
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvest_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;

-- admin は全テーブル全操作可
CREATE POLICY admin_all ON users            FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON customers        FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON products         FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON orders           FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON order_items      FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON harvest_tasks    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON invoices         FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON invoice_items    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON audit_log        FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON invoice_counters FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 自分のプロフィールは本人が参照可
CREATE POLICY user_self_read ON users FOR SELECT USING (id = auth.uid());

-- staff：マスタは参照のみ
CREATE POLICY staff_read ON customers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY staff_read ON products  FOR SELECT USING (auth.role() = 'authenticated');

-- staff：割当てられた収穫タスクのみ参照・更新（security.md の staff_own 例）
CREATE POLICY staff_own ON harvest_tasks FOR SELECT USING (assigned_to = auth.uid());
CREATE POLICY staff_own_update ON harvest_tasks FOR UPDATE
  USING (assigned_to = auth.uid()) WITH CHECK (assigned_to = auth.uid());

-- staff：出荷対象の注文・明細は参照可（圃場マトリックス表示用）
CREATE POLICY staff_read ON orders      FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY staff_read ON order_items FOR SELECT USING (auth.role() = 'authenticated');
