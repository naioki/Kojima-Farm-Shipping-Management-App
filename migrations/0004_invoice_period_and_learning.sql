-- ============================================================
-- 0004_invoice_period_and_learning.sql
--   - invoices：任意期間（開始日〜終了日）対応。billing_month は採番・表示用に残す。
--   - customer_parse_hints：取引先ごとの表記学習（few-shot）。一度の修正を次回プロンプトに注入。
-- ============================================================

-- 請求の対象期間（任意の日付範囲。月締め以外＝20日締め等にも対応）
ALTER TABLE invoices ADD COLUMN period_start DATE;
ALTER TABLE invoices ADD COLUMN period_end   DATE;

-- 取引先ごとの表記学習（features.md §4 名寄せの強化）
--   「この取引先はトマトを『桃太郎』と書く」等を蓄積し、Gemini プロンプトに few-shot 注入する。
--   admin が承認画面で修正したときに upsert される想定。
CREATE TABLE customer_parse_hints (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  raw_name       TEXT NOT NULL,                       -- 取引先が使う表記（OCR/原文のまま）
  product_id     UUID REFERENCES products(id),        -- 正しい品目（マスタ参照）
  corrected_name TEXT,                                 -- 正しい品目名のスナップショット
  note           TEXT,                                 -- 任意メモ（数量表記の癖など）
  hit_count      INTEGER NOT NULL DEFAULT 1,           -- 学習の信頼度（出現回数）
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, raw_name)
);
CREATE INDEX idx_cph_customer ON customer_parse_hints(customer_id);
ALTER TABLE customer_parse_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON customer_parse_hints FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE TRIGGER trg_cph_updated BEFORE UPDATE ON customer_parse_hints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
