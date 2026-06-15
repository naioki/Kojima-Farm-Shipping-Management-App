-- 0010: 価格（期間×取引先）・荷姿（多形態）・後決め請求のデータモデル
-- 設計（4概念分離）:
--   品目(products.base_unit) / 荷姿(pack_configs) / 価格(price_rules) / 不変台帳(order_items 凍結)
-- 原則:
--   - 内部は基準単位(base_unit)に正規化して集計する
--   - 価格は後決め可。凍結点は「注文時」ではなく「請求確定時(invoice finalize)」
--   - 請求数量は実出荷(shipped_qty)基準。赤点(品質減)は billable_qty を下げて表す
--   - 既存の order_items.subtotal/tax_amount/line_total(生成列)は変更しない（受注額の記録として残す）
--     請求は billable_qty × 確定単価 をアプリ側(lib/invoices)で計算する

-- ① 品目に基準単位（在庫・収穫・集計を同一尺度にそろえる）
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_unit TEXT NOT NULL DEFAULT '個';
COMMENT ON COLUMN products.base_unit IS '基準単位。在庫・収穫・数量集計はこの単位に正規化する。';

-- ② 荷姿マスタ（1商品×取引先につき何形態でも持てる）。準正規化（内→外の2階層）＋基準換算。
CREATE TABLE pack_configs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id),
  customer_id         UUID REFERENCES customers(id),          -- NULL=共通荷姿、指定=取引先専用
  label               TEXT NOT NULL,                          -- 表示名「スタンドパック3個入り12袋」等
  -- 階層（表示・換算の補助。base_per_selling が換算の真実）
  inner_unit_label    TEXT,                                   -- 例「袋」
  inner_per           NUMERIC,                                -- 1内装あたりの基準単位数（袋=3個 → 3）
  outer_unit_label    TEXT,                                   -- 例「ケース」
  outer_per           NUMERIC,                                -- 1外装あたりの内装数（ケース=12袋 → 12）
  selling_unit_label  TEXT NOT NULL,                          -- 注文・価格の単位名「ケース」「コンテナ」
  base_per_selling    NUMERIC(14, 3) NOT NULL CHECK (base_per_selling > 0), -- 販売単位1あたりの基準単位数（換算の橋）
  needs_manual_confirm BOOLEAN NOT NULL DEFAULT FALSE,        -- 組合指定等、自動確定せず人手確認
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pack_configs_product ON pack_configs(product_id);
CREATE INDEX idx_pack_configs_customer ON pack_configs(customer_id);

-- ③ 価格表（期間×取引先×荷姿×チャネル）。有効期間は開始日のみ＋「最新優先」。
CREATE TABLE price_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  customer_id     UUID REFERENCES customers(id),             -- NULL=定価（全社共通）
  pack_config_id  UUID REFERENCES pack_configs(id),          -- NULL=荷姿非依存
  channel         TEXT CHECK (channel IN ('fax','email','portal','manual')), -- NULL=全チャネル
  price_unit      TEXT NOT NULL DEFAULT 'base' CHECK (price_unit IN ('base','pack')), -- 基準単位/販売単位あたり
  unit_price      NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  tax_rate        SMALLINT NOT NULL CHECK (tax_rate IN (8, 10)),
  effective_from  DATE NOT NULL,                             -- この日以降に有効（最新優先で解決）
  effective_to    DATE,                                      -- 廃止用途のみ（通常 NULL）
  note            TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_price_rules_resolve ON price_rules(product_id, customer_id, effective_from DESC);

-- ④ order_items に価格ライフサイクル（後決め）と請求数量（実出荷・赤点）を追加
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_status TEXT NOT NULL DEFAULT 'unpriced'
  CHECK (price_status IN ('unpriced', 'provisional', 'confirmed'));
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS billable_qty NUMERIC(14, 2);   -- NULL=shipped_qty→quantity の順で採用
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS billable_reason TEXT;          -- 赤点（数量減）の理由
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pricing_reference_date DATE;   -- 価格表を引く基準日（既定=出荷日）
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS priced_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS priced_by UUID REFERENCES users(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pack_config_id UUID REFERENCES pack_configs(id);
COMMENT ON COLUMN order_items.price_status IS '価格状態。unpriced→provisional→confirmed。confirmed のみ請求可。';
COMMENT ON COLUMN order_items.billable_qty IS '請求対象数量。既定は実出荷数。赤点(品質減)はここを下げる。';

-- RLS（価格・荷姿は管理者のみ。security.md / 既存と同じ is_admin()）
ALTER TABLE pack_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_rules  ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON pack_configs FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON price_rules  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
