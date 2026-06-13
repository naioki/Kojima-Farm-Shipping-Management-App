-- ============================================================
-- 0005_packaging_fields.sql — 規格・荷姿・カード有無・追記事項
--   - customer_product_rules：事前登録の既定（規格・カード有無）。荷姿は既存 container_type。
--   - order_items：各出荷の実値スナップショット（規則から自動補完＋出荷ごとに上書き可）。
--     税率と同じく注文時の値を冗長保持し、規則変更が過去出荷を変えないようにする。
-- ============================================================

-- 事前登録（取引先×商品の既定）
ALTER TABLE customer_product_rules ADD COLUMN spec     TEXT;                         -- 規格（例: Lサイズ/200g）
ALTER TABLE customer_product_rules ADD COLUMN has_card BOOLEAN NOT NULL DEFAULT FALSE; -- カード同梱の有無

-- 各出荷の実値（規則から自動補完。アコーディオンで上書き・追記）
ALTER TABLE order_items ADD COLUMN spec           TEXT;     -- 規格
ALTER TABLE order_items ADD COLUMN container_type TEXT;     -- 荷姿（ケース/箱/化粧箱）
ALTER TABLE order_items ADD COLUMN has_card       BOOLEAN;  -- カード有無（null=未設定）
ALTER TABLE order_items ADD COLUMN line_note      TEXT;     -- 追記事項（その出荷だけの指示）
