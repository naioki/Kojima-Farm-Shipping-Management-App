-- ============================================================
-- 0002_features_phase_a.sql — features.md §1 の新規4テーブル＋既存カラム追加
-- ============================================================
-- 並列スキーマを作らない方針（PROMPT.md）に従い、新規は order_receipts /
-- customer_product_rules / harvest_estimates / gemini_usage_log の4つのみ。
-- 変更履歴・Undo は既存 audit_log の上に構築（新テーブルを作らない）。
-- 各新規テーブルは RLS を同時作成（security.md）。
-- ============================================================

-- ------------------------------------------------------------
-- ① order_receipts（受信ログ・重複/再送判定の中核）
-- ------------------------------------------------------------
CREATE TABLE order_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT NOT NULL CHECK (channel IN ('fax', 'email', 'portal', 'manual')),
  customer_id     UUID REFERENCES customers(id),          -- 未紐付けは NULL
  order_id        UUID REFERENCES orders(id),             -- 解析後に紐付け
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_date   DATE,                                   -- 出荷予定日（承認時に必須確定）
  sender_date_key TEXT,                                   -- "識別子_YYYYMMDD"（再送判定キー）
  exact_hash      TEXT,                                   -- FAX/画像のMD5（完全重複検知）
  message_id      TEXT,                                   -- メールの Message-ID（処理済み判定）
  r2_key          TEXT,                                   -- 原本（FAX画像/メール添付）の R2 キー
  raw_payload     JSONB,                                  -- テキスト本文・ポータル送信内容など
  is_revision     BOOLEAN DEFAULT FALSE,                  -- 再送（追加）受信か
  parent_id       UUID REFERENCES order_receipts(id),
  ocr_confidence  NUMERIC,
  status          TEXT NOT NULL DEFAULT 'pending_ai'
    CHECK (status IN ('pending_ai', 'ai_failed', 'pending_review', 'approved', 'duplicate', 'unmatched')),
  retry_count     INTEGER DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX uq_receipt_exact ON order_receipts(exact_hash) WHERE exact_hash IS NOT NULL;
CREATE UNIQUE INDEX uq_receipt_msgid ON order_receipts(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_receipt_senderkey ON order_receipts(sender_date_key);

-- ------------------------------------------------------------
-- ② customer_product_rules（取引先×商品の取引ルール）
-- ------------------------------------------------------------
CREATE TABLE customer_product_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES customers(id),
  product_id         UUID NOT NULL REFERENCES products(id),
  packs_per_case     NUMERIC,                  -- P/C（スマートパース・OCR検証の基準値）
  container_type     TEXT,                     -- "ケース"/"箱"/"化粧箱"
  label_spec         TEXT,                     -- "Oisixラベル"/"農園独自" 等
  tape_color         TEXT,                     -- "透明"/"黄"/"赤"
  packing_notes      TEXT,
  fraction_policy    TEXT DEFAULT 'confirm'
    CHECK (fraction_policy IN ('carry_over', 'loose', 'round_down', 'confirm')),
  is_default_set     BOOLEAN DEFAULT FALSE,    -- 「いつものセット」に含むか
  default_quantity   NUMERIC,                  -- 定番セットの既定数量
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (customer_id, product_id)
);
CREATE INDEX idx_cpr_customer ON customer_product_rules(customer_id);

-- ------------------------------------------------------------
-- ③ harvest_estimates（収穫見込み。日付×商品）
-- ------------------------------------------------------------
CREATE TABLE harvest_estimates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  estimate_date   DATE NOT NULL,
  planned_qty     NUMERIC,                     -- 事前計画（複数日一括入力）
  estimate_qty    NUMERIC,                     -- 当日朝の見直し
  actual_qty      NUMERIC,                     -- 実収穫（後から確定）
  carry_over      NUMERIC DEFAULT 0,           -- 前日繰越
  adjustment_memo TEXT,                        -- 「第3ハウス不調」等
  status          TEXT NOT NULL DEFAULT 'not_entered'
    CHECK (status IN ('not_entered', 'planned', 'estimated', 'confirmed')),
  created_by      UUID REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, estimate_date)
);
CREATE INDEX idx_estimate_date ON harvest_estimates(estimate_date);

-- ------------------------------------------------------------
-- ④ gemini_usage_log（無料枠管理）
-- ------------------------------------------------------------
CREATE TABLE gemini_usage_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  called_at   TIMESTAMPTZ DEFAULT now(),
  mode        TEXT,        -- 'normal'/'diff'
  channel     TEXT,
  tokens_used INTEGER,
  success     BOOLEAN
);
CREATE INDEX idx_gemini_called ON gemini_usage_log(called_at);

-- ============================================================
-- 既存テーブルへの追加カラム（features.md §1）
-- ============================================================

-- orders：出荷日ソースと再送・追加メタ
ALTER TABLE orders ADD COLUMN delivery_date_source TEXT
  CHECK (delivery_date_source IN ('parsed', 'manual', 'assumed_next_day'));
ALTER TABLE orders ADD COLUMN confirmed_no_order BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN shipping_time TEXT CHECK (shipping_time IN ('am', 'pm'));

-- order_items：楽観ロック・荷姿・出荷実績・端数メモ・確信度
ALTER TABLE order_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_items ADD COLUMN rule_id UUID REFERENCES customer_product_rules(id);
ALTER TABLE order_items ADD COLUMN confidence NUMERIC;
ALTER TABLE order_items ADD COLUMN is_flagged BOOLEAN DEFAULT FALSE;  -- confidence<0.7
ALTER TABLE order_items ADD COLUMN shipped_qty NUMERIC;               -- 実出荷数（部分完了）
ALTER TABLE order_items ADD COLUMN shipped_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN field_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (field_status IN ('not_started', 'packed', 'shipped'));       -- タップループ用
ALTER TABLE order_items ADD COLUMN fraction_note TEXT;

-- customers：チャネル別識別子（FAX番号/メール/ポータルユーザー/LINE WORKS ID）
ALTER TABLE customers ADD COLUMN channel_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- RLS — 新規4テーブル（security.md：新テーブルはポリシー同時作成）
-- ============================================================
ALTER TABLE order_receipts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_product_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvest_estimates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gemini_usage_log       ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all ON order_receipts         FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON customer_product_rules FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON harvest_estimates      FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all ON gemini_usage_log       FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- staff：荷姿ルールは参照のみ（出荷指示書表示）／収穫見込みは現場が入力する
CREATE POLICY staff_read ON customer_product_rules FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY staff_rw   ON harvest_estimates FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- ポータルRLS（features.md §2-3）：取引先は自分の customer_id の注文のみ参照可
--   app_metadata.customer_id が無いユーザーは NULL となり一致しない（=不可視）。
-- ============================================================
CREATE POLICY portal_own ON orders FOR SELECT
  USING (customer_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'customer_id', '')::uuid);

CREATE POLICY portal_own ON order_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items.order_id
      AND o.customer_id = NULLIF(auth.jwt() -> 'app_metadata' ->> 'customer_id', '')::uuid
  ));
