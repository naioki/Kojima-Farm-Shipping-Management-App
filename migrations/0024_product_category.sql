-- 0024: 品目グループ（category）。表示上のグルーピング専用（データ構造・パース・請求には非関与）。
-- 「トマト」「トマトバラ」のように規格違いで独立品目になっているものを、選択UIで
-- optgroup にまとめて選びやすくする。category は自由記述だが、商品マスタ編集では
-- datalist で既存グループを補完し表記ゆれを防ぐ。NULL=未分類（UIでは「その他」に集約）。
-- 冪等。

ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
COMMENT ON COLUMN products.category IS
  '品目グループ（表示上の分類のみ。換算・価格・税には非関与）。NULL=未分類。';

-- 既存品目に初期グループを付与（v4運用実績どおりのバラ・平箱系の親品目に寄せる）。
-- 明示的に空でないものだけ上書き（既に手入力済みなら尊重）。
UPDATE products SET category = 'トマト'   WHERE category IS NULL AND name IN ('トマト', 'トマトバラ');
UPDATE products SET category = 'キュウリ' WHERE category IS NULL AND name IN ('キュウリ', '胡瓜バラ', '胡瓜平箱');
UPDATE products SET category = 'ネギ'     WHERE category IS NULL AND name IN ('ネギ', '長ねぎバラ');
UPDATE products SET category = '資材'     WHERE category IS NULL AND name IN ('梱包資材', '送料');
