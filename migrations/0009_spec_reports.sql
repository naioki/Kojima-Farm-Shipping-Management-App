-- 0009: 規格変更の「現場報告」
-- 目的: 現場（スタッフ）が「箱・規格が変わったかも」を写真＋メモで報告する。
--   これは規格マスタ(customer_product_rules)の【直接編集ではない】。報告→管理者が確認して反映。
--   既存の規格ガバナンス（ロック・マスター・audit履歴・通知）を壊さず、現場の気づきを拾う。

CREATE TABLE spec_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID REFERENCES customers(id),          -- 対象取引先（不明なら NULL 可）
  product_id   UUID REFERENCES products(id),           -- 対象商品（不明なら NULL 可）
  note         TEXT NOT NULL,                           -- 何が変わったか（必須）
  photo_url    TEXT,                                    -- R2 キー（任意・未設定環境ではメモのみ）
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'handled', 'dismissed')),
  reported_by  UUID REFERENCES users(id),
  handled_by   UUID REFERENCES users(id),
  handled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_spec_reports_status ON spec_reports(status, created_at DESC);
CREATE INDEX idx_spec_reports_customer ON spec_reports(customer_id);

-- RLS: 管理者は全権。スタッフは自分の報告を作成・閲覧できる（編集・他人の閲覧は不可）。
ALTER TABLE spec_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON spec_reports
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_insert_own ON spec_reports
  FOR INSERT WITH CHECK (reported_by = auth.uid());
CREATE POLICY staff_select_own ON spec_reports
  FOR SELECT USING (reported_by = auth.uid());
