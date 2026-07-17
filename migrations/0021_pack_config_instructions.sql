-- 0021: 荷姿マスタ(pack_configs)の作業指示拡張（出荷ミス防止）。
-- 規格・カード/シール・テープ色・ラベル種別・値札・返却容器・品質注意・固定追記・現場メモを任意列で持つ。
-- 加えて完成見本/注意点の写真を pack_config_photos（最大4枚/荷姿・アプリ側で制限）で保持する。
-- すべて冪等（IF NOT EXISTS / DROP POLICY IF EXISTS）。過去帳票への遡及はしない（表示・作業指示のみ）。

-- ① pack_configs へ作業指示の任意列を追加
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS spec_note            TEXT;    -- 規格: サイズ・等級等の自由記述
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS has_card             BOOLEAN; -- カード有無（NULL=未設定）
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS has_seal             BOOLEAN; -- シール有無（NULL=未設定）
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS tape_color           TEXT;    -- テープ色
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS label_spec           TEXT;    -- ラベル種別（Oisix/農園独自/組合指定等）
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS price_tag_required   BOOLEAN; -- 値札・バーコード貼付要否（NULL=未設定）
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS returnable_container BOOLEAN; -- 通い箱/折りコン返却要否（NULL=未設定）
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS quality_note         TEXT;    -- 保冷・傷みやすさ等の品質注意
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS standing_notes       TEXT;    -- 固定の追加事項（帳票に毎回出す）
ALTER TABLE pack_configs ADD COLUMN IF NOT EXISTS field_memo           TEXT;    -- 現場メモ（現場画面にのみ表示）

COMMENT ON COLUMN pack_configs.standing_notes IS '固定の追加事項。帳票系にも表示する（現場のみの field_memo と区別）。';
COMMENT ON COLUMN pack_configs.field_memo IS '現場メモ。現場画面にのみ表示（帳票には出さない）。';

-- ② 荷姿の作業写真（完成見本/注意点）
CREATE TABLE IF NOT EXISTS pack_config_photos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_config_id UUID NOT NULL REFERENCES pack_configs(id) ON DELETE CASCADE,
  storage_path   TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'finish' CHECK (kind IN ('finish','caution')), -- finish=完成見本, caution=注意点
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pack_config_photos_config ON pack_config_photos(pack_config_id);

-- RLS（0010 の pack_configs と同方針: 管理者は全操作。作業指示は現場も読むため staff 読み取りを許す）
ALTER TABLE pack_config_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all  ON pack_config_photos;
DROP POLICY IF EXISTS staff_read ON pack_config_photos;
CREATE POLICY admin_all  ON pack_config_photos FOR ALL    USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read ON pack_config_photos FOR SELECT USING (auth.role() = 'authenticated');

-- pack_configs は 0010 で admin のみ（現場は読めない）。作業指示を現場の出荷一覧に出すため
-- staff 読み取りポリシーを追加する（書き込みは引き続き admin のみ）。
DROP POLICY IF EXISTS staff_read ON pack_configs;
CREATE POLICY staff_read ON pack_configs FOR SELECT USING (auth.role() = 'authenticated');

-- ③ Storage バケット（非公開）。閲覧は署名URL経由のみ（0015 deliveries と同方針）
INSERT INTO storage.buckets (id, name, public)
VALUES ('pack-photos', 'pack-photos', false)
ON CONFLICT (id) DO NOTHING;
