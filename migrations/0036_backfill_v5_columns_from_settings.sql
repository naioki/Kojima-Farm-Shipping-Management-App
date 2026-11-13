-- ============================================================
-- 0036_backfill_v5_columns_from_settings.sql
-- 退避ストア（app_settings）に溜まった値を、0035 で足した列へ移す。0035 の後に流す。
-- 手順・移行後の正・退避ストアの片付けは docs/migration-v5-columns.md。
--
-- 移すもの:
--   v5_destination_routes（TEXT の JSON オブジェクト）の 'dest:<納入先ID>' エントリ
--     departureTime        → delivery_destinations.departure_time
--     shippingRouteName    → delivery_destinations.shipping_route_name
--     defaultContainerType → delivery_destinations.default_container_type
--   v5_pack_sort_order（TEXT の JSON オブジェクト { "<明細ID>": 並び順 }）
--     → order_items.daily_pack_sort_order
--     中身は明細ID → 当日のパック作業順（app/api/order-items/reorder/route.ts が書き、
--     app/field/shipments/page.tsx が `it.daily_pack_sort_order ?? packSortMap[it.id]` で読む）。
--     delivery_destinations.pack_sort_order（納入先の既定の作業順）とは別物で、こちらには退避先が無い
--     （列が無い環境では保存できず警告を返していた: app/api/destinations/[id]/route.ts）ので、移す値も無い。
--
-- 移さないもの（退避ストアに残す）:
--   'cust:<取引先ID>:<納入先名>' / 'cust:<取引先ID>:default' / 'date:<日付>:...' のキー。
--     納入先の行に対応しない（取引先単位・その日だけの一時変更）ので列が無い。今後も退避ストアが唯一の保存先。
--   'dest:<ID>' のうち、ID が UUID でない・納入先が存在しない（削除済み）・エントリがオブジェクトでないもの。
--   値が文字列でない（数値・配列など）、または空白だけの項目。値 null は「未設定」なので移すものが無い。
--   v5_pack_sort_order のうち、キーが UUID でない・明細が存在しない・値が整数でないもの。
--   退避ストア全体が JSON として壊れている／オブジェクトでない場合はそのストアから何も移さない。
--   いずれも件数を NOTICE で出す。
--
-- 規則:
--   - 冪等: 列が NULL（文字列の列は空白だけも未設定扱い）のときだけ書く。2回目以降は「一致済み」に数えるだけ
--   - 列に既に値があれば上書きしない（退避ストアと違えば「食い違い」として件数を NOTICE）
--   - 値は加工しない（trim もしない。読む側が trim する）
--   - 退避ストア（app_settings）は読むだけで変更しない
--   - 移した値は public.v5_column_backfill_log に1件ずつ記録する（ロールバック・監査用）
--
-- ロールバック（この 0036 だけを戻す。退避ストアは変更していないので戻す必要はない）:
--   UPDATE public.delivery_destinations d SET departure_time = NULL
--     FROM public.v5_column_backfill_log l
--    WHERE l.table_name = 'delivery_destinations' AND l.column_name = 'departure_time'
--      AND l.row_id = d.id AND d.departure_time IS NOT DISTINCT FROM l.value;
--   （shipping_route_name / default_container_type も同じ形。order_items.daily_pack_sort_order は
--     `d.daily_pack_sort_order::text IS NOT DISTINCT FROM l.value`）
--   「列の値がまだ移したときの値のまま」の行だけを戻すので、移行後にアプリが書き換えた値は消さない。
--   戻したあと DROP TABLE public.v5_column_backfill_log;
--   なお読む側は「退避ストア ↔ 列」のどちらかから同じ値を得るので、戻さなくても表示は変わらない。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.v5_column_backfill_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_id      UUID NOT NULL,
  column_name TEXT NOT NULL,
  value       TEXT,
  source_key  TEXT NOT NULL,
  moved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.v5_column_backfill_log IS '0036 が退避ストアから列へ移した値の記録（ロールバック・監査用。確認後に削除してよい）';
-- 社内の作業記録なので API からは見せない（RLS 有効・ポリシー無し＝service_role だけ）
ALTER TABLE public.v5_column_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v5_column_backfill_log FROM anon, authenticated;

DO $$
DECLARE
  uuid_re CONSTANT TEXT := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  raw_text   TEXT;
  store      JSONB;
  ent        RECORD;
  dest_id    UUID;
  f          RECORD;
  v          JSONB;
  cur        TEXT;
  n_moved    INT := 0;
  n_same     INT := 0;
  n_conflict INT := 0;
  n_badval   INT := 0;
  n_badkey   INT := 0;
  n_orphan   INT := 0;
  n_badent   INT := 0;
  n_kept     INT := 0;
  item_id    UUID;
  cur_int    INT;
  new_int    INT;
BEGIN
  -- ---------- 1. v5_destination_routes の dest:<id> → delivery_destinations ----------
  SELECT value INTO raw_text FROM public.app_settings WHERE key = 'v5_destination_routes';
  IF raw_text IS NULL THEN
    RAISE NOTICE '[0036] v5_destination_routes: 行が無い（または値が NULL）ので移すものなし';
  ELSE
    BEGIN
      store := raw_text::jsonb;
    EXCEPTION WHEN others THEN
      store := NULL;
    END;
    IF store IS NULL OR jsonb_typeof(store) <> 'object' THEN
      RAISE NOTICE '[0036] v5_destination_routes: JSON として壊れている／オブジェクトでない（壊れた値 1 件）。何も移さない';
    ELSE
      FOR ent IN SELECT key, value FROM jsonb_each(store) ORDER BY key LOOP
        IF ent.key NOT LIKE 'dest:%' THEN
          n_kept := n_kept + 1;  -- cust: / date: は列に対応しないので退避ストアに残す
          CONTINUE;
        END IF;
        IF substr(ent.key, 6) !~ uuid_re THEN
          n_badkey := n_badkey + 1;
          CONTINUE;
        END IF;
        dest_id := substr(ent.key, 6)::uuid;
        IF jsonb_typeof(ent.value) <> 'object' THEN
          n_badent := n_badent + 1;
          CONTINUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.delivery_destinations WHERE id = dest_id) THEN
          n_orphan := n_orphan + 1;
          CONTINUE;
        END IF;

        FOR f IN SELECT * FROM (VALUES
            ('departureTime', 'departure_time'),
            ('shippingRouteName', 'shipping_route_name'),
            ('defaultContainerType', 'default_container_type')
          ) AS t(json_key, col) LOOP
          v := ent.value -> f.json_key;
          IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
            CONTINUE;  -- 項目なし・null は「未設定」。移すものが無い
          END IF;
          IF jsonb_typeof(v) <> 'string' OR btrim(v #>> '{}') = '' THEN
            n_badval := n_badval + 1;
            CONTINUE;
          END IF;
          EXECUTE format('SELECT %I FROM public.delivery_destinations WHERE id = $1 FOR UPDATE', f.col)
            INTO cur USING dest_id;
          IF cur IS NULL OR btrim(cur) = '' THEN
            EXECUTE format('UPDATE public.delivery_destinations SET %I = $1 WHERE id = $2', f.col)
              USING (v #>> '{}'), dest_id;
            INSERT INTO public.v5_column_backfill_log (table_name, row_id, column_name, value, source_key)
            VALUES ('delivery_destinations', dest_id, f.col, v #>> '{}', 'v5_destination_routes:' || ent.key);
            n_moved := n_moved + 1;
          ELSIF cur = (v #>> '{}') THEN
            n_same := n_same + 1;
          ELSE
            n_conflict := n_conflict + 1;
            RAISE NOTICE '[0036] 食い違い（列を優先し上書きしない）: delivery_destinations.%=% / 退避ストア %.%=%',
              f.col, cur, ent.key, f.json_key, v #>> '{}';
          END IF;
        END LOOP;
      END LOOP;
      RAISE NOTICE '[0036] v5_destination_routes: 移した項目=% / 一致済み=% / 食い違い(上書きせず)=% / 不正な値=% / 不正なキー=% / エントリがオブジェクトでない=% / 納入先が無い=% / 列に対応しないキー(cust:・date:、残す)=%',
        n_moved, n_same, n_conflict, n_badval, n_badkey, n_badent, n_orphan, n_kept;
    END IF;
  END IF;

  -- ---------- 2. v5_pack_sort_order → order_items.daily_pack_sort_order ----------
  n_moved := 0; n_same := 0; n_conflict := 0; n_badval := 0; n_badkey := 0; n_orphan := 0;
  raw_text := NULL; store := NULL;
  SELECT value INTO raw_text FROM public.app_settings WHERE key = 'v5_pack_sort_order';
  IF raw_text IS NULL THEN
    RAISE NOTICE '[0036] v5_pack_sort_order: 行が無い（または値が NULL）ので移すものなし';
  ELSE
    BEGIN
      store := raw_text::jsonb;
    EXCEPTION WHEN others THEN
      store := NULL;
    END;
    IF store IS NULL OR jsonb_typeof(store) <> 'object' THEN
      RAISE NOTICE '[0036] v5_pack_sort_order: JSON として壊れている／オブジェクトでない（壊れた値 1 件）。何も移さない';
    ELSE
      FOR ent IN SELECT key, value FROM jsonb_each(store) ORDER BY key LOOP
        IF ent.key !~ uuid_re THEN
          n_badkey := n_badkey + 1;
          CONTINUE;
        END IF;
        item_id := ent.key::uuid;
        -- 整数（int4 の範囲）だけを移す。小数・文字列・null などは移さない
        IF jsonb_typeof(ent.value) <> 'number'
           OR (ent.value #>> '{}') !~ '^-?[0-9]{1,9}$' THEN
          n_badval := n_badval + 1;
          CONTINUE;
        END IF;
        new_int := (ent.value #>> '{}')::int;
        IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id = item_id) THEN
          n_orphan := n_orphan + 1;
          CONTINUE;
        END IF;
        SELECT daily_pack_sort_order INTO cur_int FROM public.order_items WHERE id = item_id FOR UPDATE;
        IF cur_int IS NULL THEN
          UPDATE public.order_items SET daily_pack_sort_order = new_int WHERE id = item_id;
          INSERT INTO public.v5_column_backfill_log (table_name, row_id, column_name, value, source_key)
          VALUES ('order_items', item_id, 'daily_pack_sort_order', new_int::text, 'v5_pack_sort_order:' || ent.key);
          n_moved := n_moved + 1;
        ELSIF cur_int = new_int THEN
          n_same := n_same + 1;
        ELSE
          n_conflict := n_conflict + 1;
          RAISE NOTICE '[0036] 食い違い（列を優先し上書きしない）: order_items(%).daily_pack_sort_order=% / 退避ストア=%',
            item_id, cur_int, new_int;
        END IF;
      END LOOP;
      RAISE NOTICE '[0036] v5_pack_sort_order: 移した明細=% / 一致済み=% / 食い違い(上書きせず)=% / 整数でない値=% / 不正なキー=% / 明細が無い=%',
        n_moved, n_same, n_conflict, n_badval, n_badkey, n_orphan;
    END IF;
  END IF;
END
$$;
