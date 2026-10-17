-- 印刷キュー print_jobs（統合2D・v4からの移設）
--
-- 事務所の常駐印刷エージェント（v4 print_agent.py・無改修で流用）が
--   GET  /print_jobs?status=eq.pending&order=created_at.asc&limit=1
--   PATCH status: processing → printed / failed（error_message 書込み）
-- という REST アクセスをするため、列名・ステータス値はv4互換を維持する。
-- エージェントは service_role キーで接続する（RLSバイパス）。
CREATE TABLE print_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type      TEXT NOT NULL CHECK (doc_type IN ('sheet','labels')),  -- 出荷表カード / 出荷ラベル
  target_date   DATE NOT NULL,                                          -- 出荷日
  product_id    UUID REFERENCES products(id),                           -- 品目しぼり込み（NULL=全品目）
  pdf_url       TEXT NOT NULL,                                          -- 署名付きURL（エージェントが直接DL）
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','printed','failed')),
  error_message TEXT,
  requested_by  UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_print_jobs_status ON print_jobs(status, created_at);
CREATE INDEX idx_print_jobs_date ON print_jobs(target_date);
CREATE TRIGGER trg_print_jobs_updated BEFORE UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: admin 全操作。認証済み（現場スタッフ）は閲覧＋投入のみ
-- （状態遷移はエージェント=service_role が行う。スタッフが printed を偽装できない）
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all    ON print_jobs FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read   ON print_jobs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY staff_insert ON print_jobs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- PDF置き場（非公開バケット。エージェントには署名付きURLを渡す）
INSERT INTO storage.buckets (id, name, public)
VALUES ('print-jobs', 'print-jobs', false)
ON CONFLICT (id) DO NOTHING;
