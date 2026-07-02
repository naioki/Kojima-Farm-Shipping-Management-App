-- 配送（deliveries）: 「取引先×納入先×配送日」を1配送とする単位。
-- 誤配送0%のための出発前チェック（checked_*）と配送完了記録（delivered_*）の受け皿。
-- 明細テーブルは作らない（並列スキーマ禁止・features.md §1）。明細は同じ
-- (delivery_date, customer_id, destination_id) を持つ orders 配下の order_items がそのまま対象。
-- Phase 0 ではスキーマのみ用意し、配送リスト・印刷帳票は orders からオンザフライ生成する。
-- 行の生成・状態遷移（planned→loaded→delivered）は Phase 1 のチェック画面で使う。
CREATE TABLE deliveries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_date  DATE NOT NULL,
  customer_id    UUID NOT NULL REFERENCES customers(id),
  destination_id UUID REFERENCES delivery_destinations(id),  -- 納入先を持たない取引先は NULL
  status         TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','loaded','delivered')),
  checked_by     UUID REFERENCES users(id),   -- 出発前ダブルチェック実施者
  checked_at     TIMESTAMPTZ,
  delivered_by   UUID REFERENCES users(id),   -- 配送完了の記録者（荷造り場で完結）
  delivered_at   TIMESTAMPTZ,
  photo_url      TEXT,                        -- 積込写真（任意・R2キー）
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- destination_id が NULL の取引先も一意にするため COALESCE でユニーク化
CREATE UNIQUE INDEX uq_delivery_unit ON deliveries(
  delivery_date, customer_id,
  COALESCE(destination_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX idx_deliveries_date ON deliveries(delivery_date);
CREATE TRIGGER trg_deliveries_updated BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ロット（lots）: 粒度は「圃場×収穫日」。J-GAPトレーサビリティ専用で、
-- 請求（invoices）とは別粒度（請求は order_items×単価から生成し、ロットは帳票に載らない）。
CREATE TABLE lots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_no         TEXT NOT NULL UNIQUE,        -- 例: 2026-07-03-荒崎-チンゲン菜
  product_id     UUID NOT NULL REFERENCES products(id),
  field_name     TEXT,                        -- 圃場名
  harvest_date   DATE,
  gap_record_ref TEXT,                        -- GAP管理台帳（施肥・農薬記録）への参照
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE order_items ADD COLUMN lot_id UUID REFERENCES lots(id);
CREATE INDEX idx_order_items_lot ON order_items(lot_id);

-- 配送イベント（append-only）: クレーム・誤配送の原因分析用。
-- UPDATE/DELETE ポリシーを意図的に作らず追記専用にする。
CREATE TABLE delivery_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  actor       UUID REFERENCES users(id),
  action      TEXT NOT NULL,                 -- 'created'/'checked'/'delivered'/'reverted' 等
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_events_delivery ON delivery_events(delivery_id);

-- RLS（0013 delivery_destinations と同方針: admin全操作・認証済みは閲覧。
-- スタッフのチェック操作は Phase 1 で API 経由の UPDATE ポリシーを追加する）
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all  ON deliveries FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read ON deliveries FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all  ON lots FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read ON lots FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE delivery_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all   ON delivery_events FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read  ON delivery_events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY staff_write ON delivery_events FOR INSERT WITH CHECK (auth.role() = 'authenticated');
