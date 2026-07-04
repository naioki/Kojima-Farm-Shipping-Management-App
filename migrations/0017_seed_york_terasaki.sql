-- ヨーク・寺崎を取引先マスタに登録（アプリ統合フェーズ2の受け皿準備）
--
-- 背景: v4アプリ（kojima-farm-app-v4）ではヨーク系9店舗が customers に平らに登録され
-- 系列の概念がなかったため、出荷表の供給先が店舗名のみになり現場の仕分けミスを招いていた。
-- 本アプリの「取引先(customers) ＞ 納入先(delivery_destinations)」モデルはこの2概念を
-- 最初から分離しており、統合時は v4 の customers.supplier_name → 取引先、店舗 → 納入先に
-- 機械的に対応づけられる。このシードはその対応の受け皿を先に用意するもの。
--
-- ・ヨーク: 店舗指定あり → 納入先9店舗をぶら下げる（表示は「ヨーク ＞ 東道野辺」）
-- ・寺崎  : 店舗指定なし → 納入先を持たない取引先（表示は「寺崎」のみ）。
--           これまでLINE手動運用だった受注を手動入力チャネルに載せられるようにする。
-- 冪等: 既存の同名取引先・納入先があれば挿入しない。

INSERT INTO customers (name, name_kana)
SELECT 'ヨーク', 'ヨーク'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = 'ヨーク');

INSERT INTO customers (name, name_kana)
SELECT '寺崎', 'テラサキ'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = '寺崎');

-- ヨークの納入先9店舗（sort_order は v4 の配送順に合わせる）
WITH york AS (SELECT id FROM customers WHERE name = 'ヨーク' LIMIT 1),
     stores(full_name, sort_order) AS (
       VALUES ('習志野台', 1), ('咲が丘', 2), ('青葉台', 3),
              ('八柱', 4), ('五香', 5), ('鎌ケ谷', 6),
              ('東道野辺', 7), ('夏見台', 8), ('八千代台', 9)
     )
INSERT INTO delivery_destinations (customer_id, full_name, sort_order)
SELECT york.id, s.full_name, s.sort_order
  FROM york, stores s
 WHERE NOT EXISTS (
   SELECT 1 FROM delivery_destinations d
    WHERE d.customer_id = york.id AND d.full_name = s.full_name
 );
