-- 納入先（delivery_destinations）: 取引先の配下にぶら下がる「届け先」。
-- 和郷園のように 1取引先＝複数納入先 のケースに対応（マトリクスFAX）。
-- 請求・締めは取引先(customers)単位。納入先は注文の内訳・出荷表示・名寄せに使う。
-- 表示は常に「取引先 ＞ 納入先」。納入先単独では出さない（人の認知＝和郷園のどこ、に合わせる）。
CREATE TABLE delivery_destinations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  code        TEXT,                              -- 略称/コード（FAX左の短い名・表示用）例: マルタ
  full_name   TEXT NOT NULL,                     -- 正式名（伝票用）例: 東海コープ(株)エムエルティ
  aliases     TEXT[] NOT NULL DEFAULT '{}',      -- OCR表記ゆれ吸収（products.aliases と同方針）
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dest_customer ON delivery_destinations(customer_id);
CREATE TRIGGER trg_dest_updated BEFORE UPDATE ON delivery_destinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 注文に納入先を紐付け（nullable: 納入先を持たない取引先は従来通り取引先のみ）
ALTER TABLE orders ADD COLUMN destination_id UUID REFERENCES delivery_destinations(id);
CREATE INDEX idx_orders_destination ON orders(destination_id);

-- RLS（customer_product_rules と同じ：admin は全操作、認証済みは閲覧のみ）
ALTER TABLE delivery_destinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all  ON delivery_destinations FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read ON delivery_destinations FOR SELECT USING (auth.role() = 'authenticated');
