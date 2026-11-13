# 本番に無い v5 列の追加と、退避ストアからの移行（0035 / 0036）

> 2026-11-13 作成。**準備のみ。本番には未適用。** 適用するときはこの文書の §4 の順で行う。
> 背景は `.claude/rules/engineering.md` §1（本番に無い列・退避ストア）。

## 1. 何をするか

| ファイル | 内容 |
|---|---|
| `migrations/0035_add_v5_missing_columns.sql` | 本番に無い列を `ADD COLUMN IF NOT EXISTS` で足す。値は動かさない |
| `migrations/0036_backfill_v5_columns_from_settings.sql` | 退避ストア（`app_settings`）の値を列へ移す。退避ストアは読むだけ |

足す列と、本番の既存行に入る値:

| 列 | 型 | 既存行 | 今の挙動との関係 |
|---|---|---|---|
| `delivery_destinations.departure_time` | TEXT | NULL → 0036 で移す | — |
| `delivery_destinations.shipping_route_name` | TEXT | NULL → 0036 で移す | — |
| `delivery_destinations.default_container_type` | TEXT | NULL → 0036 で移す | — |
| `delivery_destinations.pack_sort_order` | INTEGER NOT NULL DEFAULT 100 | 全行 100 | 読む側の既定 `?? 100` と同じ。変わらない |
| `order_items.bag_type` / `seal_text` | TEXT | NULL | 列が無い今の undefined と同じ |
| `order_items.has_seal` | BOOLEAN | NULL | `it.has_seal ?? ルール` で同じ |
| `order_items.is_manual_modified` | BOOLEAN NOT NULL DEFAULT FALSE | 全行 FALSE | 今は undefined（偽）。同じ |
| `customer_product_rules.seal_text` / `bag_type` | TEXT | NULL | 同じ |
| `customer_product_rules.has_seal` | **BOOLEAN（NULL 可）** | NULL | 同じ（下記） |

`customer_product_rules.has_seal` だけは 0026 の定義（`NOT NULL DEFAULT FALSE`）から外している。読む側
（`app/api/shipments/route.ts`・`app/api/shipments/cell/route.ts`・`app/api/orders/route.ts`・現場の出荷一覧）は
「ルールの has_seal が boolean ならそれ、そうでなければ NSK の判定・シール文言の有無で決める」ため、0026 のとおり
FALSE で埋めると本番の既存ルール全件が「シールなし」になり、NSK のシールあり判定が黙って消える。
**0026 / 0029 を本番に流し直さないこと**（0035 の後なら該当列は IF NOT EXISTS で何もしないが、順番を誤ると FALSE で埋まる）。

CHECK 制約は 0026 / 0029 にも無く、出発時刻は `'11:30'`・`'翌午前'`・`'am'` などの自由文字列なので足さない。

## 2. 何をどこへ移すか（0036）

| 退避ストア | 形 | 移し先 |
|---|---|---|
| `v5_destination_routes` の `dest:<納入先ID>` | `{departureTime, shippingRouteName, defaultContainerType}` | `delivery_destinations` の `departure_time` / `shipping_route_name` / `default_container_type` |
| `v5_destination_routes` の `cust:<取引先ID>:<名前>`・`cust:<取引先ID>:default`・`date:<日付>:...` | 同上 | **移さない**（納入先の行に対応しない。取引先単位・その日だけの値。今後も退避ストアが唯一の保存先） |
| `v5_pack_sort_order` | `{"<明細ID>": 並び順}` | `order_items.daily_pack_sort_order` |

`v5_pack_sort_order` は `app/api/order-items/reorder/route.ts` が書く「明細ID → 当日のパック作業順」で、
現場の出荷一覧は `it.daily_pack_sort_order ?? packSortMap[it.id]` で読む。**`delivery_destinations.pack_sort_order`
（納入先の既定の作業順）とは別物**。納入先の既定の作業順には退避先が無かった（列が無い環境では保存できず警告を返していた）
ので、移す値も無い。`daily_pack_sort_order` 自体は本番に既にある列（engineering.md §1 の一覧に無い）。0035 は念のため
`ADD COLUMN IF NOT EXISTS` を置いているが、本番では何もしない。

0036 の規則:

- 列が NULL（文字列の列は空白だけも未設定扱い）のときだけ書く。列に値があれば上書きせず、退避ストアと違えば「食い違い」として NOTICE
- 2回目以降は「一致済み」に数えるだけ（冪等）
- 値は加工しない（trim もしない。読む側が trim する）
- 移さないもの（件数を NOTICE）: 退避ストア全体が JSON として壊れている／オブジェクトでない（そのストアからは何も移さない）、
  キーが UUID でない、納入先・明細が存在しない、エントリがオブジェクトでない、値が文字列でない・空白だけ、並び順が整数でない
- 移した値は `public.v5_column_backfill_log` に1件ずつ記録（RLS 有効・ポリシー無し＝service_role だけ）

## 3. 列が入った後のアプリの動き（移行後の正と二重管理）

### 移行後の正

**納入先の行に対応する値（`dest:<id>` の3項目・明細の並び順）は列が正。** 退避ストアの `dest:<id>` は列の控え（ミラー）として
当面残す。`cust:`・`date:` キーは列が無いので引き続き退避ストアが正。

### 書く側（列が入ると）

| 経路 | 列 | 退避ストア |
|---|---|---|
| `PATCH /api/destinations/[id]` 出発時刻・便名 | 書く | 常に同期（従来どおり） |
| `PATCH /api/destinations/[id]` 規定コンテナ | 書く | **常に同期（今回変更）**。空にしたら退避ストアからも消す |
| `POST /api/destinations` | 書く | 出発時刻・便名は同期。規定コンテナは列に書けたら書かない（新しい納入先なので古い値が無い） |
| `POST /api/deliveries/departure-time`（scope=master） | 書く | 同期（`dest:`・`cust:`・`date:` の各キー） |
| `PATCH /api/order-items/[id]` のコンテナ変更 | 納入先の規定コンテナ列を更新 | 書かない。読む側は列が先なので問題なし |
| `POST /api/order-items/reorder` | `daily_pack_sort_order` | 同期（従来どおり） |

### 読む側の優先順位（そのまま）

- 出発時刻・便名: 現場の出荷一覧・配送リスト・遅延 cron は **退避ストア（date: → dest: → cust:）→ 列**、
  取引先詳細（`app/(dashboard)/admin/customers/[id]/page.tsx`）は **列 → 退避ストア**
- 規定コンテナ: `resolveDestDefaultContainer` で **列 → 退避ストア**
- 明細の並び順: **列 → 退避ストア**

### 二重管理で食い違いが起きないか（確認結果）

1. **出発時刻・便名**: 書く経路はすべて列と退避ストアの両方に同じ値を書く。0036 で列＝退避ストアにしてから使い始めるので、
   どちらを先に読んでも同じ値になる。例外は「列には書けたが退避ストアの同期だけ失敗」したときで、退避ストアを先に読む現場画面に
   古い値が出る。これは今も成功＋警告（「控えの更新に失敗しました…もう一度保存してください」）で返しており、もう一度保存すれば揃う。
2. **規定コンテナ（今回直した点）**: 変更前は、列があると列にだけ書き、退避ストアには書かなかった。読む側は「列 → 退避ストア」なので、
   0036 の後に規定コンテナを**空にする**と列が NULL になり、退避ストアに残っていた移行前の値が復活していた。
   `app/api/destinations/[id]/route.ts` を「列があっても退避ストアに同期する（空なら消す）」に変更した。列が無い今の本番では
   もともと退避ストアにだけ書いていたので挙動は同じ（テスト `tests/destination-container-fallback.test.ts` の
   「列が無い環境の規定コンテナ」6件が変更なしで通る）。列がある環境の3件（同期・空にしたら消える・同期失敗は警告）を追加した。
3. **明細の並び順**: reorder は列が書けたら退避ストアも同期（削除含む）。読む側は列が先。0036 で列が NULL の明細だけ移すので、
   画面の並びは移行前後で同じ（`列 ?? 退避ストア` の結果が変わらない）。
4. **列に対応しないキー**（`cust:`・`date:`）: 移さず、書き方・読み方も変わらない。

## 4. 本番に適用する手順

事前確認（読み取りのみ）:

1. 本番の列の有無を確認（0035 の対象が本当に無いこと・`order_items.daily_pack_sort_order` があること）:
   ```sql
   SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('delivery_destinations','order_items','customer_product_rules')
      AND column_name IN ('departure_time','shipping_route_name','pack_sort_order','default_container_type',
        'bag_type','seal_text','has_seal','is_manual_modified','daily_pack_sort_order');
   ```
2. 退避ストアをバックアップし、JSON として読めるか確認:
   ```sql
   CREATE TABLE public._backup_app_settings_v5_20261113 AS
     SELECT * FROM public.app_settings WHERE key IN ('v5_destination_routes','v5_pack_sort_order');
   SELECT key, length(value), jsonb_typeof(value::jsonb) FROM public.app_settings
    WHERE key IN ('v5_destination_routes','v5_pack_sort_order');  -- 壊れていればここで失敗する（0036 は何も移さない）
   ```
3. 移る予定の件数を把握: `SELECT count(*) FROM jsonb_object_keys((SELECT value::jsonb FROM app_settings WHERE key='v5_destination_routes')) k WHERE k LIKE 'dest:%';`

適用:

4. `0035` を流す（列の追加だけ。テーブルの書き直しなし）。最後の `NOTIFY pgrst, 'reload schema'` で PostgREST が列を認識する。
   この時点からアプリは列に書き始める。0036 までの間も、読む側は列が NULL なら退避ストアを読むので表示は変わらない。
5. 続けて `0036` を流し、NOTICE の件数を記録する（「食い違い」「不正な値」「納入先が無い」が出たら内容を確認。食い違いは列が優先で上書きしない）。

事後確認:

6. 列と退避ストアの一致:
   ```sql
   SELECT d.id, d.full_name,
     (e->>'departureTime') IS NOT DISTINCT FROM d.departure_time AS dep_ok,
     (e->>'shippingRouteName') IS NOT DISTINCT FROM d.shipping_route_name AS route_ok,
     (e->>'defaultContainerType') IS NOT DISTINCT FROM d.default_container_type AS cont_ok
   FROM public.delivery_destinations d,
     LATERAL (SELECT (SELECT value FROM public.app_settings WHERE key='v5_destination_routes')::jsonb -> ('dest:'||d.id) AS e) s
   WHERE jsonb_typeof(e) = 'object';
   ```
   （退避ストアの値が空白だけ・文字列でない項目は移していないので false になりうる。NOTICE の「不正な値」と件数が合うこと）
7. 退避ストアが変わっていないこと（手順2のバックアップと `md5(value)` が同じ）。
8. 画面で確認: 取引先詳細の納入先（出発時刻・便名・規定コンテナが移行前と同じ）、現場の出荷一覧（締め時刻・並び順・規定コンテナ）、
   配送リスト。納入先の並び順・規定コンテナを保存して警告が出ないこと。
9. `.claude/rules/engineering.md` §1 の「本番に無い列」の記述を更新する（コード側の作業）。

ロールバック:

- 0036 だけ戻す: `0036` 冒頭コメントの SQL（`v5_column_backfill_log` を使い、「列の値が移したときのまま」の行だけ NULL に戻す）。
  退避ストアは変更していないので戻す必要はない。戻さなくても表示は変わらない。
- 0035 まで戻す: `0035` 冒頭コメントの SQL（必要なら列の値を退避してから DROP COLUMN）。出発時刻・便名・規定コンテナは
  退避ストアにも同期されているので、列を落とせばアプリは今と同じく退避ストアから読む。納入先の並び順・明細の袋/シール・
  取引先ルールの袋/シールなど列にだけ書いた値は消える。

## 5. 退避ストアを片付ける手順（将来・別作業）

列が入って運用が落ち着いた（数週間、食い違いの警告が出ていない）後に行う。今回は行わない。

1. コード: 列がある前提にして、`dest:<id>` への同期書き込みと、`dest:` の読み出し（`resolveDestDefaultContainer` の退避ストア側、
   現場画面の `routeOverrides['dest:'+id]`）をやめる。`v5_pack_sort_order` の読み書き（reorder の退避経路・同期、出荷一覧の
   `packSortMap`）もやめる。`cust:`・`date:` キーは残す（列が無いので退避ストアが正のまま）。
   `lib/supabase/missing-column.ts` のフォールバック自体は他の列でも使うので残す。
2. デプロイ後、もう一度 §4 手順6の一致確認をし、食い違いがあれば列を正として確認する。
3. 退避ストアから `dest:` エントリを消す（バックアップを取ってから）:
   ```sql
   UPDATE public.app_settings
      SET value = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)::text
                     FROM jsonb_each(value::jsonb) AS t(k, v) WHERE k NOT LIKE 'dest:%'),
          updated_at = now()
    WHERE key = 'v5_destination_routes';
   DELETE FROM public.app_settings WHERE key = 'v5_pack_sort_order';
   ```
4. `public.v5_column_backfill_log` と手順2のバックアップ表を削除。

## 6. ローカル Postgres での検証記録（2026-11-13）

本番には接続していない。このコンテナの PostgreSQL 16 で一時の DB を作って確認した。

```bash
# 一時のクラスタ（postgres ユーザー、/tmp/v3pg、ソケットのみ・ポート 55435）
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/v3pg/data -U postgres -E UTF8 --locale=C.UTF-8"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/v3pg/data -o '-p 55435 -k /tmp/v3pg -c listen_addresses=' -l /tmp/v3pg/pg.log start"
psql -h /tmp/v3pg -p 55435 -U postgres -c "CREATE DATABASE v3test"
# Supabase の代用品（anon / authenticated / service_role ロール、auth.uid()/role()/jwt()、auth.users、storage.buckets/objects）
psql ... -d v3test -f 00_supabase_shim.sql
for f in migrations/0001*.sql ... migrations/0033*.sql; do psql ... -v ON_ERROR_STOP=1 -f $f; done   # 33本すべて成功
```

`00_supabase_shim.sql`（ローカル検証専用）:

```sql
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
```

本番と同じ状態を作る（`10_prod_like.sql`）:

- 9列（＋本番の `customer_product_rules` に無い `has_seal` / `bag_type`）を DROP COLUMN。0035 前の該当列数 = 0 を確認
- 納入先 A〜D、明細 01〜03（01: 列 NULL、02: 列 7、03: 列 2）
- `v5_destination_routes`: A=全3項目、B=規定コンテナだけ、C=出発時刻＋便名 null、存在しない納入先ID、UUID でないキー、
  文字列のエントリ（壊れたエントリ）、`cust:` 2件、`date:` 1件
- `v5_pack_sort_order`: 01=3、02=7（列と一致）、03=5（列 2 と食い違い）、存在しない明細、`1.5`（整数でない）

1回目（0035 → 0036）の NOTICE:

```
[0036] v5_destination_routes: 移した項目=5 / 一致済み=0 / 食い違い(上書きせず)=0 / 不正な値=0 / 不正なキー=1 / エントリがオブジェクトでない=1 / 納入先が無い=1 / 列に対応しないキー(cust:・date:、残す)=3
[0036] 食い違い（列を優先し上書きしない）: order_items(...03).daily_pack_sort_order=2 / 退避ストア=5
[0036] v5_pack_sort_order: 移した明細=1 / 一致済み=1 / 食い違い(上書きせず)=1 / 整数でない値=1 / 不正なキー=0 / 明細が無い=1
```

結果: A店 = `11:30 / 岩槻便 / 青コン`、B店 = 規定コンテナ `茶コン` だけ、C店 = `翌午前` だけ、D店と既存の納入先は NULL、
`pack_sort_order` は全行 100。列と退避ストアの一致確認は A/B/C 全項目 true。明細 01 = 3（移した）、02 = 7、03 = 2（上書きしていない）。
明細の `is_manual_modified` = false、`has_seal`/`bag_type`/`seal_text` = NULL、取引先ルールの `has_seal` = NULL。
`v5_column_backfill_log` = 6行。退避ストア2件の `md5(value)` は適用前と同じ（`8ccabc0c…` / `f74c1982…`）＝変更していない。

2回目（0035 → 0036 を再実行）: 0035 は全列「already exists, skipping」。0036 は「移した項目=0 / 一致済み=5」「移した明細=0 / 一致済み=2」。
確認クエリの出力（列の値・一致確認・md5・ログ行数）は1回目と `diff` で完全一致。

追加の確認（いずれもトランザクション内で実行して ROLLBACK）:

- 退避ストア全体が壊れている（`{"dest:aaaaaaaa` と `[1,2]`）: 「JSON として壊れている／オブジェクトでない（壊れた値 1 件）。何も移さない」が2件。列・ログは変わらない
- 値が数値・空白だけ: 「不正な値=2」で移さない。同じエントリの文字列の規定コンテナ（`黄コン`）は移る。列に既に別の値（A店 `11:30` に対し退避ストア `09:00`）: 「食い違い」で上書きしない
- 0036 のロールバック SQL: 移したままの列は NULL に戻り、移行後に書き換えた値（A店の便名 `変更後の便`）と、移したものではない値（明細 02 = 7、03 = 2）は残る
- 0035 のロールバック SQL: 対象列が 0 になり、退避ストアの md5 は変わらない

後片付け: `pg_ctl stop` のうえ `/tmp/v3pg` を削除。
