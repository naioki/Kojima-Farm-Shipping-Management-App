-- =====================================================
-- 地域農業DXプラットフォーム: 初期スキーマ
-- =====================================================

-- ① テナント（農場）
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'standard', 'enterprise')),
  settings      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ② ユーザー（Supabase Auth と紐付け）
CREATE TABLE users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'backoffice', 'field', 'customer')),
  display_name  TEXT NOT NULL,
  email         TEXT,
  locale        TEXT NOT NULL DEFAULT 'ja',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_tenant_role ON users(tenant_id, role);

-- ③ 得意先（顧客）マスタ
CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_kana       TEXT,
  fax_number      TEXT,
  email           TEXT,
  address         TEXT,
  payment_terms   TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX idx_customers_fax ON customers(tenant_id, fax_number);

-- ④ 商品マスタ
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  base_unit       TEXT NOT NULL,
  price_per_unit  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5, 4) NOT NULL DEFAULT 0.10,
  category        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_products_tenant_id ON products(tenant_id);

-- ⑤ 単位換算マスタ（バラ→箱 等。ハードコードなし）
CREATE TABLE unit_conversion_master (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_unit       TEXT NOT NULL,
  to_unit         TEXT NOT NULL,
  multiplier      NUMERIC(12, 6) NOT NULL,
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, from_unit, to_unit, effective_from)
);

CREATE INDEX idx_ucm_tenant_product ON unit_conversion_master(tenant_id, product_id);
CREATE INDEX idx_ucm_active ON unit_conversion_master(tenant_id, product_id, from_unit)
  WHERE effective_to IS NULL;

-- ⑥ Magic Link（B2Bポータル・パスワードレス認証）
CREATE TABLE magic_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  email_sent_to   TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  session_token   TEXT UNIQUE,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_magic_links_tenant ON magic_links(tenant_id, customer_id);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at) WHERE used_at IS NULL;

-- ⑦ OCR/メール検証キュー（Human-in-the-loop）
CREATE TABLE order_verification_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('fax', 'email', 'i_plus')),
  raw_data        JSONB NOT NULL,
  parsed_data     JSONB,
  ocr_confidence  NUMERIC(5, 4),
  raw_storage_path TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'needs_correction')),
  review_notes    TEXT,
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ovq_tenant_status ON order_verification_queue(tenant_id, status);

-- ⑧ 受注
CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           UUID NOT NULL REFERENCES customers(id),
  source                TEXT NOT NULL
                        CHECK (source IN ('fax', 'email', 'manual', 'b2b_portal', 'i_plus')),
  verification_queue_id UUID REFERENCES order_verification_queue(id),
  delivery_date         DATE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN (
                          'confirmed', 'packing', 'shipped', 'invoiced', 'cancelled'
                        )),
  notes                 TEXT,
  raw_input_ref         TEXT,
  parsed_data           JSONB,
  total_amount          NUMERIC(14, 2),
  created_by            UUID REFERENCES users(id),
  verified_by           UUID REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX idx_orders_customer ON orders(tenant_id, customer_id);
CREATE INDEX idx_orders_delivery_date ON orders(tenant_id, delivery_date);
CREATE INDEX idx_orders_status ON orders(tenant_id, status);

-- ⑨ 受注明細
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  ordered_qty     NUMERIC(12, 3) NOT NULL,
  ordered_unit    TEXT NOT NULL,
  converted_qty   NUMERIC(12, 3) NOT NULL,
  unit_price      NUMERIC(12, 2) NOT NULL,
  tax_rate        NUMERIC(5, 4) NOT NULL,
  line_total      NUMERIC(14, 2) GENERATED ALWAYS AS
                    (converted_qty * unit_price) STORED,
  notes           TEXT,
  revised_qty     NUMERIC(12, 3),
  revised_at      TIMESTAMPTZ,
  revised_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_tenant ON order_items(tenant_id);

-- ⑩ 圃場出荷タスク（タップループのメイン状態管理）
-- tap_state: 0=未着手(白) / 1=梱包完了(緑✓) / 2=出荷済み(グレー🚚)
-- is_partial=true かつ tap_state=0 → 黄色（部分完了）
CREATE TABLE shipping_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_item_id    UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  order_id         UUID NOT NULL REFERENCES orders(id),
  customer_id      UUID NOT NULL REFERENCES customers(id),
  product_id       UUID NOT NULL REFERENCES products(id),
  delivery_date    DATE NOT NULL,
  assigned_qty     NUMERIC(12, 3) NOT NULL,
  tap_state        SMALLINT NOT NULL DEFAULT 0
                   CHECK (tap_state IN (0, 1, 2)),
  packed_qty       NUMERIC(12, 3),
  is_partial       BOOLEAN NOT NULL DEFAULT false,
  has_unack_change BOOLEAN NOT NULL DEFAULT false,
  ack_change_at    TIMESTAMPTZ,
  acked_by         UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_item_id, delivery_date)
);

CREATE INDEX idx_shipping_tasks_tenant_date ON shipping_tasks(tenant_id, delivery_date);
CREATE INDEX idx_shipping_tasks_customer ON shipping_tasks(tenant_id, customer_id, delivery_date);
CREATE INDEX idx_shipping_tasks_unack ON shipping_tasks(tenant_id, has_unack_change)
  WHERE has_unack_change = true;

-- ⑪ 数量変更通知（バックオフィス→圃場リアルタイムアラート）
CREATE TABLE change_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipping_task_id  UUID NOT NULL REFERENCES shipping_tasks(id) ON DELETE CASCADE,
  order_item_id     UUID NOT NULL REFERENCES order_items(id),
  previous_qty      NUMERIC(12, 3) NOT NULL,
  new_qty           NUMERIC(12, 3) NOT NULL,
  delta             NUMERIC(12, 3) GENERATED ALWAYS AS (new_qty - previous_qty) STORED,
  changed_by        UUID NOT NULL REFERENCES users(id),
  acknowledged_by   UUID REFERENCES users(id),
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_change_notif_task ON change_notifications(shipping_task_id);
CREATE INDEX idx_change_notif_unack ON change_notifications(tenant_id, acknowledged_at)
  WHERE acknowledged_at IS NULL;

-- ⑫ 請求書
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  invoice_number  TEXT NOT NULL,
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  period_from     DATE NOT NULL,
  period_to       DATE NOT NULL,
  subtotal        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  pdf_storage_path TEXT,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX idx_invoices_tenant ON invoices(tenant_id, customer_id);
CREATE INDEX idx_invoices_status ON invoices(tenant_id, status);

-- ⑬ 請求書明細
CREATE TABLE invoice_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_item_id   UUID NOT NULL REFERENCES order_items(id),
  product_name    TEXT NOT NULL,
  qty             NUMERIC(12, 3) NOT NULL,
  unit_price      NUMERIC(12, 2) NOT NULL,
  tax_rate        NUMERIC(5, 4) NOT NULL,
  line_total      NUMERIC(14, 2) NOT NULL
);

-- ⑭ 監査ログ
CREATE TABLE audit_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  actor_id      UUID REFERENCES users(id),
  actor_type    TEXT NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   UUID,
  before_data   JSONB,
  after_data    JSONB,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
