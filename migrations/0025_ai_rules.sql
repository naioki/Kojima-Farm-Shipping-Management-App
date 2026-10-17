-- 0025: 取引先別AI読取ルール（ai_rules）テーブル作成 & 指示書 v2.3 / パイプライン Ver 4.1 統合マイグレーション
-- 小島農園 受発注DXシステム Webアプリ一本化・刷新計画書（docs/web_app_migration_plan.md）および
-- Kojima-FAX Ver 4.0 / kojima-farm-order-pipeline Ver 4.1 (ARCHITECTURE.md) 準拠。
-- すべて冪等（CREATE TABLE IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / NOT EXISTS シード）で安全に再実行可能。

-- ============================================================
-- 1. order_receipts.status の CHECK 制約拡張 & 未紐付け受注の許容
-- ============================================================
-- 既存 0002_features_phase_a.sql では status が
-- ('pending_ai', 'ai_failed', 'pending_review', 'approved', 'duplicate', 'unmatched') のみだったため、
-- 注文外スキップ ('not_order')、却下 ('dismissed')、処理完了 ('processed') を正式に許可する。
ALTER TABLE public.order_receipts
  DROP CONSTRAINT IF EXISTS order_receipts_status_check;

ALTER TABLE public.order_receipts
  ADD CONSTRAINT order_receipts_status_check
  CHECK (status IN (
    'pending_ai',
    'ai_failed',
    'pending_review',
    'approved',
    'duplicate',
    'unmatched',
    'not_order',
    'dismissed',
    'processed'
  ));

-- 未登録取引先や未登録品目のFAXでも「承認待ち（pending_review）」としてスプリット承認画面に載せられるよう
-- orders.customer_id と order_items.product_id の NOT NULL 制約を緩和（承認時に人間が確定するゲートは維持）
ALTER TABLE public.orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN product_id DROP NOT NULL;

-- ============================================================
-- 2. チンゲン菜（青梗菜）主要4社マスタ・FAX番号・納入先・荷姿（20入/24入）初期シード
-- ============================================================
-- ① 品目マスタ: 「青梗菜」（または「チンゲン菜」）に全表記ゆれ別名を付与
INSERT INTO public.products (name, unit, base_unit, category, aliases)
SELECT
  '青梗菜',
  'P',
  'P',
  'チンゲン菜',
  ARRAY['チンゲン菜', 'ちんげん菜', 'チンゲンサイ', 'ちんげんさい', '青梗菜', 'チンゲン菜(2~3株)', 'チンゲン菜200g', 'チンゲンサイ200gUP']
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p WHERE p.name IN ('青梗菜', 'チンゲン菜')
);

UPDATE public.products
SET
  category = COALESCE(category, 'チンゲン菜'),
  aliases = (
    SELECT array_agg(DISTINCT a)
    FROM unnest(
      aliases || ARRAY['チンゲン菜', 'ちんげん菜', 'チンゲンサイ', 'ちんげんさい', '青梗菜', 'チンゲン菜(2~3株)', 'チンゲン菜200g', 'チンゲンサイ200gUP']
    ) AS a
  )
WHERE name IN ('青梗菜', 'チンゲン菜');

-- ② 取引先マスタ（主要4社）: 0022 の normalize_org_name 一意インデックスに準拠して冪等挿入
INSERT INTO public.customers (name, name_kana, channel_identifiers)
SELECT v.name, v.name_kana, v.channel_identifiers::jsonb
FROM (
  VALUES
    (
      '農事組合法人 和郷園',
      'ノウジクミアイホウジン ワゴウエン',
      '{"fax": ["0478-78-5504", "0478785504"], "subject_keywords": ["和郷園"]}'
    ),
    (
      '農事組合法人 房総食料センター',
      'ノウジクミアイホウジン ボウソウショクリョウセンター',
      '{"fax": ["0478-78-5502", "0478785502"], "subject_keywords": ["房総食料センター", "房総食料"]}'
    ),
    (
      '株式会社勘兵衛',
      'カブシキガイシャ カンベエ',
      '{"subject_keywords": ["勘兵衛"]}'
    ),
    (
      '株式会社農業総合研究所（NSK）',
      'カブシキガイシャ ノウギョウソウゴウケンキュウジョ',
      '{"subject_keywords": ["農業総合研究所", "NSK", "農総研"]}'
    )
) AS v(name, name_kana, channel_identifiers)
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c
  WHERE public.normalize_org_name(c.name) = public.normalize_org_name(v.name)
);

-- 既存の同名取引先がある場合は FAX 識別子を補完（手動変更は上書きしない）
UPDATE public.customers
SET channel_identifiers = '{"fax": ["0478-78-5504", "0478785504"], "subject_keywords": ["和郷園"]}'::jsonb || channel_identifiers
WHERE public.normalize_org_name(name) = public.normalize_org_name('農事組合法人 和郷園')
  AND NOT (channel_identifiers ? 'fax');

UPDATE public.customers
SET channel_identifiers = '{"fax": ["0478-78-5502", "0478785502"], "subject_keywords": ["房総食料センター", "房総食料"]}'::jsonb || channel_identifiers
WHERE public.normalize_org_name(name) = public.normalize_org_name('農事組合法人 房総食料センター')
  AND NOT (channel_identifiers ? 'fax');

-- ③ 納入先マスタ（delivery_destinations）: 取引先 ＞ 納入先 の階層とOCR別名を登録
WITH target_dests(cust_norm, code, full_name, aliases, sort_order) AS (
  VALUES
    (
      public.normalize_org_name('農事組合法人 和郷園'),
      'パルシステム 岩槻',
      'パルシステム 岩槻',
      ARRAY['岩槻', 'パルシステム岩槻', '青コン岩槻', '岩槻セットセンター'],
      1
    ),
    (
      public.normalize_org_name('農事組合法人 和郷園'),
      'ちばコープ グリーンボックス(戸田)',
      'ちばコープ グリーンボックス(戸田)',
      ARRAY['(戸田)', '戸田', 'ちばコープグリーンボックス(戸田)', '茶コン(戸田)', 'グリーンボックス(戸田)'],
      2
    ),
    (
      public.normalize_org_name('農事組合法人 和郷園'),
      'ちばコープ グリンBOXサンプル戸田',
      'ちばコープ グリンBOXサンプル戸田',
      ARRAY['グリンBOXサンプル戸田', 'サンプル戸田', 'グリーンボックス(ミニ)用サンプル'],
      3
    ),
    (
      public.normalize_org_name('農事組合法人 房総食料センター'),
      'BOX用',
      'BOX用',
      ARRAY['BOX', 'ボックス用', '出荷割振連絡表'],
      1
    ),
    (
      public.normalize_org_name('株式会社勘兵衛'),
      'イオンタウン向け',
      'イオンタウン向け',
      ARRAY['イオンタウン', 'イオン向け'],
      1
    ),
    (
      public.normalize_org_name('株式会社農業総合研究所（NSK）'),
      '4関東顧客向け',
      '4関東顧客向け',
      ARRAY['関東顧客向け', '4関東', 'NSK関東'],
      1
    )
)
INSERT INTO public.delivery_destinations (customer_id, code, full_name, aliases, sort_order)
SELECT c.id, td.code, td.full_name, td.aliases, td.sort_order
FROM target_dests td
JOIN public.customers c ON public.normalize_org_name(c.name) = td.cust_norm
WHERE NOT EXISTS (
  SELECT 1 FROM public.delivery_destinations d
  WHERE d.customer_id = c.id
    AND public.normalize_org_name(d.full_name) = public.normalize_org_name(td.full_name)
);

-- ④ 荷姿マスタ（pack_configs）: チンゲン菜の入数20（標準）と入数24（NSK専用）を登録
WITH bok_choy AS (
  SELECT id FROM public.products WHERE name IN ('青梗菜', 'チンゲン菜') ORDER BY created_at ASC LIMIT 1
),
nsk_cust AS (
  SELECT id FROM public.customers WHERE public.normalize_org_name(name) = public.normalize_org_name('株式会社農業総合研究所（NSK）') LIMIT 1
)
INSERT INTO public.pack_configs (product_id, customer_id, label, selling_unit_label, base_per_selling)
SELECT
  bok_choy.id,
  v.customer_id,
  v.label,
  v.selling_unit_label,
  v.base_per_selling
FROM bok_choy
CROSS JOIN (
  SELECT NULL::uuid AS customer_id, '2〜3株 (入数20)' AS label, 'ケース' AS selling_unit_label, 20::numeric AS base_per_selling
  UNION ALL
  SELECT NULL::uuid, '200g (入数20)', 'ケース', 20::numeric
  UNION ALL
  SELECT NULL::uuid, '200gFG×20入', 'ケース', 20::numeric
  UNION ALL
  SELECT (SELECT id FROM nsk_cust), '200gUP (入数24)', 'ケース', 24::numeric
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM public.pack_configs pc
  WHERE pc.product_id = bok_choy.id AND pc.label = v.label
);

-- ============================================================
-- 3. 取引先別AI読取ルール（ai_rules）テーブル作成 & 指示書 v2.3 標準9ルール初期シード
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 10,
  category TEXT NOT NULL DEFAULT 'parsing',
  source TEXT NOT NULL DEFAULT 'seed_v2.3',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_rules IS
  '取引先別のAI読取ルール・ナレッジ管理テーブル（Gemini動的プロンプト注入用）。';

CREATE INDEX IF NOT EXISTS idx_ai_rules_client ON public.ai_rules(client_name);
CREATE INDEX IF NOT EXISTS idx_ai_rules_active ON public.ai_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_rules_priority ON public.ai_rules(priority, created_at);

-- RLS（security.md / 0023_rls_staff_isolation.sql 準拠）
ALTER TABLE public.ai_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all ON public.ai_rules;
CREATE POLICY admin_all ON public.ai_rules FOR ALL
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS staff_read ON public.ai_rules;
CREATE POLICY staff_read ON public.ai_rules FOR SELECT
  USING ((SELECT public.is_staff()));

-- 指示書 v2.3 & ARCHITECTURE.md Ver 4.1 標準ルール初期シード（冪等）
INSERT INTO public.ai_rules (client_name, rule_text, priority, category, source)
SELECT v.client_name, v.rule_text, v.priority, 'parsing', v.source
FROM (
  VALUES
    (
      '農事組合法人 和郷園',
      '【和郷園・週間マトリクス】数値は『総数+端数 (ケース-端数)』表記であり、先頭の数字を総パック数とする（例: 300+0 (15-0) → 総300P・15ケース・端数0P）。★印は新規追加枠に『★』を入れ特記事項には入れない。週間マトリクス再送で行が消滅しても取消線がなければ自動取消にせず『要確認』とする。',
      1,
      'seed_v2.3'
    ),
    (
      '農事組合法人 和郷園',
      '【和郷園・OCR文字潰れ補正】マテハンが『青コン』で『岩槻』を含む行は納品先『パルシステム 岩槻』・規格『2〜3株 (入数20)』・容器『青コン』に統一し、マテハンが『茶コン』で『(戸田)』を含む行は納品先『ちばコープ グリーンボックス(戸田)』・規格『2〜3株 (入数20)』・容器『茶コン』に統一する。',
      2,
      'seed_v2.3'
    ),
    (
      '農事組合法人 和郷園',
      '【和郷園・グリーンボックス(ミニ)用サンプル依頼書】生産者欄が『小島正之』かつ品目が『チンゲン菜』の行のみ抽出し、他生産者は無視する。納品先は『ちばコープ グリンBOXサンプル戸田』、規格は『2〜3株 (入数20)』、数量1は総1Pとする。',
      3,
      'seed_v2.3'
    ),
    (
      '農事組合法人 房総食料センター',
      '【房総食料センター】出荷割振連絡表の盤面数値は総パック数とし、納品先は『BOX用』、品目名は『チンゲン菜』、規格は明細行の『200g (入数20)』を正とする（小コン記載は無視し通常コンテナを使用）。',
      4,
      'seed_v2.3'
    ),
    (
      '農事組合法人 房総食料センター',
      '【房総食料センター・約表記と手書き修正】印刷の『約 80』等は暫定値として『状態=要確認』とし、後日二重線等で手書き確定数字（84等）に修正されたFAXでは手書き数字を最優先で採用して更新する。質問事項は『【要返答】』として記録する。',
      5,
      'seed_v2.3'
    ),
    (
      '株式会社勘兵衛',
      '【株式会社勘兵衛】イオンタウン向け発注書の盤面数値はケース数（単位: C/S）であり、入数20を掛けた値を総パック数とする（例: 2 → 総40P・2ケース・端数0P）。納品先は『イオンタウン向け』、品目名は『チンゲン菜』、規格は『200gFG×20入』、通常コンテナを使用する。',
      6,
      'seed_v2.3'
    ),
    (
      '株式会社農業総合研究所（NSK）',
      '【農業総合研究所（NSK）】生産者欄が『小島裕美』（生産者番号11）等のチンゲンサイ行を抽出し、入数24（総パック数÷24）でケース・端数を換算する。規格は『200gUP (入数24)』、容器は『農業総研専用折りたたみコンテナ』を使用し、シール欄が『あり』の場合は特記事項に『シールあり（生産者11:小島裕美 / 買値¥◯◯）』を記載する。',
      7,
      'seed_v2.3'
    ),
    (
      '共通',
      '【対象品目限定・注文外スキップ】小島農園の出荷対象は『チンゲン菜（青梗菜）』のみとし、JA富里のきゅうり・トマト出荷割振表やオレンジファームのししとう注文書、案内状・チラシ等はすべて注文外FAX（対象外）としてスキップする。',
      8,
      'seed_v2.3'
    ),
    (
      '共通',
      '【コンテナ集計・入数検算ルール】入数は規格欄の指定（なければ20、NSKは24）とし、箱数は『ケース + (端数P>0なら1)』で納品先ごとに端数を切り上げる。盤面数値とケース×入数＋端数が不一致または文字かすれ時は『要確認』とする。',
      9,
      'seed_v2.3'
    )
) AS v(client_name, rule_text, priority, source)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_rules existing
  WHERE existing.client_name = v.client_name
    AND existing.rule_text = v.rule_text
);

-- ── 5. 2段階AIモデル（メイン: gemini-3.5-flash-lite / 重要箇所: gemini-3.8-flash）＆自動承認しきい値の初期設定（未設定時のみ投入）──
INSERT INTO public.app_settings (key, value)
VALUES
  ('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
  ('GEMINI_MODEL_HIGH', 'gemini-3.8-flash'),
  ('AUTO_APPROVE_THRESHOLD', '0.80')
ON CONFLICT (key) DO NOTHING;
