-- ============================================================
-- 0035_add_v5_missing_columns.sql
-- 本番に無い 0026 / 0029 の列を足す（engineering.md §1「本番に無い列」）。列を足すだけで、値は動かさない。
-- 退避ストア（app_settings）から列への値の移行は 0036、手順と移行後の正は docs/migration-v5-columns.md。
--
-- すべて ADD COLUMN IF NOT EXISTS（冪等。列がある環境では何もしない）。
-- 定数の既定値つきの ADD COLUMN は PostgreSQL 11 以降テーブルの書き直しを伴わない（既存行には既定値が見える）。
--
-- 既存の行にどう入るか（本番）:
--   delivery_destinations.pack_sort_order     → 全行 100。読む側の既定（app/field/shipments/page.tsx の
--                                                `dest?.pack_sort_order ?? 100`）と同じなので並び順は変わらない
--   delivery_destinations.departure_time / shipping_route_name / default_container_type → NULL（0036 で退避ストアから移す）
--   order_items.is_manual_modified            → 全行 FALSE。列が無い今は undefined（偽）として扱われているので同じ
--   order_items.bag_type / seal_text / has_seal → NULL。列が無い今の undefined と同じ扱い（`it.has_seal ?? ルール` など）
--   customer_product_rules.bag_type / seal_text → NULL
--   customer_product_rules.has_seal           → NULL（**0026 の NOT NULL DEFAULT FALSE から意図して外している**。下記）
--
-- customer_product_rules.has_seal を NULL 可にする理由:
--   読む側（app/api/shipments/route.ts・app/api/shipments/cell/route.ts・app/api/orders/route.ts・現場の出荷一覧）は
--   「ルールの has_seal が boolean ならそれ、無ければ NSK の判定やシール文言の有無で決める」。0026 のとおり
--   NOT NULL DEFAULT FALSE で足すと、本番の既存ルール全件が「シールなし」と明示されたことになり、NSK 向けの
--   シールあり判定が黙って消える。NULL（＝未設定）なら列が無い今と同じ判定になる。書く側は boolean だけを書く
--   （app/api/order-items/[id]/route.ts）か、判定結果（null もありうる: app/api/shipments/route.ts の rulePayload）
--   を書くので、NULL 可のほうがコードが書く値にも合う。
--   **このため 0026 / 0029 を本番に流し直さないこと**（この列は 0035 で既にあるので IF NOT EXISTS で何もしないが、
--   0035 より前に 0026 を流すと既存ルールが FALSE で埋まる）。
--
-- CHECK 制約: 0026 / 0029 にも無い。コードが書く値も自由文字列（出発時刻は '11:30' / '翌午前' / 'am' など）なので足さない。
--
-- ロールバック（0036 を先に戻すこと。0036 のコメント参照）:
--   列を落とすと、0035 適用後にアプリが列にだけ書いた値（納入先の並び順、明細の袋・シール・手動修正マーク、
--   取引先ルールの袋・シール）は消える。必要なら先に退避してから落とす:
--     CREATE TABLE public._rollback_v5_cols_dd  AS SELECT id, departure_time, shipping_route_name, pack_sort_order, default_container_type FROM public.delivery_destinations;
--     CREATE TABLE public._rollback_v5_cols_oi  AS SELECT id, bag_type, seal_text, has_seal, is_manual_modified FROM public.order_items;
--     CREATE TABLE public._rollback_v5_cols_cpr AS SELECT id, bag_type, seal_text, has_seal FROM public.customer_product_rules;
--   そのうえで:
--     ALTER TABLE public.delivery_destinations DROP COLUMN IF EXISTS departure_time, DROP COLUMN IF EXISTS shipping_route_name,
--       DROP COLUMN IF EXISTS pack_sort_order, DROP COLUMN IF EXISTS default_container_type;
--     ALTER TABLE public.order_items DROP COLUMN IF EXISTS bag_type, DROP COLUMN IF EXISTS seal_text,
--       DROP COLUMN IF EXISTS has_seal, DROP COLUMN IF EXISTS is_manual_modified;
--     ALTER TABLE public.customer_product_rules DROP COLUMN IF EXISTS bag_type, DROP COLUMN IF EXISTS seal_text,
--       DROP COLUMN IF EXISTS has_seal;
--     NOTIFY pgrst, 'reload schema';
--   出発時刻・便名・規定コンテナは退避ストアにも同期されている（docs/migration-v5-columns.md §3）ので、列を落とせば
--   アプリは今と同じく退避ストアから読む。
-- ============================================================

-- 1. 納入先: 出発時刻・便名・パック作業順の既定・規定コンテナ（0026 §2 / 0029 と同じ定義）
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS departure_time TEXT;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS shipping_route_name TEXT;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS pack_sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE public.delivery_destinations ADD COLUMN IF NOT EXISTS default_container_type TEXT;

COMMENT ON COLUMN public.delivery_destinations.departure_time IS '出発時刻（''11:30'' / ''翌午前'' など自由文字列）。退避ストア v5_destination_routes の dest:<id>.departureTime と同期';
COMMENT ON COLUMN public.delivery_destinations.shipping_route_name IS '便名。退避ストア v5_destination_routes の dest:<id>.shippingRouteName と同期';
COMMENT ON COLUMN public.delivery_destinations.pack_sort_order IS '納入先の既定のパック作業順（小さいほど先。既定 100）';
COMMENT ON COLUMN public.delivery_destinations.default_container_type IS '納入先の規定コンテナ。退避ストア v5_destination_routes の dest:<id>.defaultContainerType と同期';

-- 2. 明細: 資材指示・手動修正マーク（0026 §1 / 0029 と同じ定義）
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS bag_type TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS seal_text TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS has_seal BOOLEAN;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_manual_modified BOOLEAN NOT NULL DEFAULT FALSE;
-- 0036 が v5_pack_sort_order の移し先に使う列。本番には既にある（engineering.md §1 の一覧に無い）ので通常は何もしない
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS daily_pack_sort_order INTEGER;

COMMENT ON COLUMN public.order_items.bag_type IS '袋種別 (印字/無地/FG/スタンドパック等)';
COMMENT ON COLUMN public.order_items.seal_text IS 'シール指示 (シールあり/生産者11:小島裕美等)';
COMMENT ON COLUMN public.order_items.is_manual_modified IS '手動修正保護マーク (FAX再送による誤上書き防止)';

-- 3. 取引先×品目ルール: 資材の既定（has_seal は 0026 と違い NULL 可。冒頭の理由を参照）
ALTER TABLE public.customer_product_rules ADD COLUMN IF NOT EXISTS bag_type TEXT;
ALTER TABLE public.customer_product_rules ADD COLUMN IF NOT EXISTS seal_text TEXT;
ALTER TABLE public.customer_product_rules ADD COLUMN IF NOT EXISTS has_seal BOOLEAN;

COMMENT ON COLUMN public.customer_product_rules.has_seal IS 'シールの既定。NULL=未設定（NSK判定・シール文言の有無で決める）';

-- PostgREST の schema cache を読み直させる（Supabase 上で有効。ローカルの素の Postgres では何も起きない）
NOTIFY pgrst, 'reload schema';
