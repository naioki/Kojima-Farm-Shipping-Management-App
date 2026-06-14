-- 0007: 納品書の履歴（発行時スナップショット）
-- 目的: 出した納品書を「いつ・誰に・どの内容・どの金額モードで」凍結して残す。
--   後から元注文(order_items)を編集しても、過去の納品書は当時の内容のまま再印刷・確認できる。
--   税務上の欠番なし要件は invoices 側の責務。納品書番号は参照用（欠番は許容）。

CREATE TABLE delivery_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_number   TEXT NOT NULL UNIQUE,                 -- 例 D202606-0001（参照用）
  customer_id   UUID NOT NULL REFERENCES customers(id),
  customer_name TEXT NOT NULL,                        -- 発行時スナップショット
  delivery_date DATE NOT NULL,
  amount_mode   TEXT NOT NULL DEFAULT 'full'
                  CHECK (amount_mode IN ('full', 'blank', 'none')),
  -- 発行時の自社情報スナップショット（後で設定を変えても過去伝票は不変）
  issuer_name    TEXT,
  issuer_address TEXT,
  issuer_tel     TEXT,
  -- 税率別合計スナップショット（金額あり/手書きの控え用）
  subtotal_8    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  subtotal_10   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  issued_by     UUID REFERENCES users(id),
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_notes_customer ON delivery_notes(customer_id);
CREATE INDEX idx_delivery_notes_date ON delivery_notes(delivery_date DESC);

-- 明細スナップショット。subtotal は生成列にせず「当時の値」を凍結して保持する。
CREATE TABLE delivery_note_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  product_name     TEXT NOT NULL,
  quantity         NUMERIC(14, 2) NOT NULL,
  unit             TEXT NOT NULL DEFAULT '個',
  unit_price       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_rate         SMALLINT NOT NULL CHECK (tax_rate IN (8, 10)),
  subtotal         NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- 発行時の税抜金額（凍結）
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_note_items_note ON delivery_note_items(delivery_note_id);

-- 月別連番の採番（invoices と同じ UPSERT 方式。参照用なので欠番は許容）。
CREATE TABLE delivery_note_counters (
  month    TEXT PRIMARY KEY,                           -- 'YYYYMM'
  last_seq INTEGER NOT NULL DEFAULT 0
);
CREATE OR REPLACE FUNCTION get_next_delivery_note_number(p_month TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  INSERT INTO delivery_note_counters(month, last_seq)
  VALUES (p_month, 1)
  ON CONFLICT (month)
  DO UPDATE SET last_seq = delivery_note_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;
END;
$$ LANGUAGE plpgsql;

-- RLS（admin 全権。security.md / 既存テーブルと同じ is_admin()）
ALTER TABLE delivery_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_note_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_note_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON delivery_notes         FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON delivery_note_items    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON delivery_note_counters FOR ALL USING (is_admin()) WITH CHECK (is_admin());
