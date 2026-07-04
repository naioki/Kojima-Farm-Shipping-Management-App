-- v4（kojima-farm-app-v4）品目・規格マスタの移行（統合フェーズ2B）
--
-- 対応方針:
--   - v4 products → 本アプリ products（名前または別名で一致すれば既存に吸収）
--       胡瓜 → キュウリ（別名一致）、長ネギ → ネギ（別名を追加して吸収）
--       バラ・平箱系（胡瓜バラ/胡瓜平箱/トマトバラ/長ねぎバラ）は v4 の運用実績どおり
--       独立品目として維持する（OCR名寄せ事故「トマト⊂トマトバラ」対策の経緯があるため）
--   - v4 product_standards（有効分のみ）→ pack_configs
--       base_per_selling = 入数(unit_size)、selling_unit_label = ケース（トマトバラのみ箱）
--       customer_id は NULL（全取引先で使える汎用荷姿。ヨーク専用にしない）
--   - v4 items.json の別名 → products.aliases（メール取り込み(2C)の名寄せを汎用化する布石）
-- 冪等: 再実行しても重複しない（v4側のマスタ変更を並行運用期間中に再同期できる）。

BEGIN;

-- 1) 既存品目に v4 別名を追加
UPDATE products SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || ARRAY['胡瓜','きゅうり','胡瓜（袋）']) a)
 WHERE name = 'キュウリ';
UPDATE products SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || ARRAY['長ネギ','長ねぎ','長ねぎ（袋）']) a)
 WHERE name = 'ネギ';

-- 2) v4 品目の新規追加（同名があればスキップ）
INSERT INTO products (name, unit, base_unit, aliases)
SELECT v.name, v.unit, v.unit, v.aliases
FROM (VALUES
  ('シシトウ',   '袋', ARRAY[]::text[]),
  ('トウモロコシ','本', ARRAY[]::text[]),
  ('トマトバラ', '箱', ARRAY[]::text[]),
  ('春菊',       '袋', ARRAY['しゅんぎく','シュンギク']),
  ('胡瓜バラ',   '本', ARRAY['きゅうりバラ','キュウリバラ','胡瓜ばら','胡瓜バラ100','きゅうりバラ100','キュウリバラ100','胡瓜ばら100','胡瓜バラ(100本)']),
  ('胡瓜平箱',   '袋', ARRAY[]::text[]),
  ('長ねぎバラ', '本', ARRAY['長ネギバラ','ネギバラ','ねぎバラ','長ねぎばら']),
  ('青梗菜',     '袋', ARRAY['チンゲン菜','ちんげん菜','チンゲンサイ','ちんげんさい'])
) AS v(name, unit, aliases)
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = v.name);

-- 3) 荷姿（v4 product_standards の有効分。product+label 一致があればスキップ）
INSERT INTO pack_configs (product_id, label, selling_unit_label, base_per_selling)
SELECT p.id, v.label, v.selling, v.base
FROM (VALUES
  ('トマト',      'スタンドパック', 'ケース', 15),
  ('キュウリ',    '3本',           'ケース', 30),
  ('キュウリ',    '4本',           'ケース', 25),
  ('キュウリ',    '7本',           'ケース', 15),
  ('ネギ',        '2本',           'ケース', 25),
  ('シシトウ',    '1袋',           'ケース', 50),
  ('トウモロコシ','40本',          'ケース', 40),
  ('トマトバラ',  '10k',           '箱',     1),
  ('春菊',        '1束',           'ケース', 30),
  ('胡瓜バラ',    '100本',         'ケース', 100),
  ('胡瓜平箱',    '平箱',          'ケース', 50),
  ('長ねぎバラ',  'バラ',          'ケース', 50),
  ('青梗菜',      '2~3株',         'ケース', 20)
) AS v(pname, label, selling, base)
JOIN products p ON p.name = v.pname
WHERE NOT EXISTS (
  SELECT 1 FROM pack_configs pc WHERE pc.product_id = p.id AND pc.label = v.label
);

COMMIT;
