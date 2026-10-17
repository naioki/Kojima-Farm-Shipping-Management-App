-- 0022: 取引先・納入先の重複登録防止（Issue#6-(5)）。
-- 正規化名（全半角統一・空白除去・法人格の表記ゆれ吸収）で関数UNIQUE INDEXを張り、
-- 「（株）小島農園」「株式会社 小島農園」等の別表記による二重登録を DB レベルで防ぐ。
-- normalize_org_name() は TS 側 lib/normalize/org-name.ts と**完全に同じ結果**を返すこと。
-- 冪等（IF NOT EXISTS / CREATE OR REPLACE）。過去データには遡及しない（重複があるとINDEX作成が失敗する）。

-- ── 正規化関数（NFKC → lower → 空白除去 → 法人格除去。TS と同順）──
-- IMMUTABLE でないと関数INDEXに使えない。normalize/lower/regexp_replace はいずれも immutable。
-- 空白を先に消してから法人格を消す（「株式 会社」→ "株式会社" → "" と吸収するため。二段 regexp_replace）。
CREATE OR REPLACE FUNCTION public.normalize_org_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT regexp_replace(
    regexp_replace(
      lower(normalize(coalesce(input, ''), NFKC)),
      '[[:space:]　]+', '', 'g'                       -- ① 空白（半角・全角）除去
    ),
    '株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|\(株\)|\(有\)|\(名\)|\(資\)|\(同\)',
    '', 'g'                                            -- ② 法人格トークン除去
  )
$$;

COMMENT ON FUNCTION public.normalize_org_name(text) IS
  '取引先/納入先の正規化名（重複判定キー）。TS lib/normalize/org-name.ts と同一結果。';

-- ── 適用前の重複確認（重要）──
-- 下記2クエリが1行でも返す場合、UNIQUE INDEX 作成は失敗する。先に重複行を統合/整理してから適用すること:
--   SELECT public.normalize_org_name(name) AS k, count(*), array_agg(id) AS ids
--     FROM public.customers GROUP BY 1 HAVING count(*) > 1;
--   SELECT customer_id, public.normalize_org_name(full_name) AS k, count(*), array_agg(id) AS ids
--     FROM public.delivery_destinations GROUP BY 1, 2 HAVING count(*) > 1;

-- ── 関数UNIQUE INDEX ──
-- 取引先: 会社全体で正規化名が一意
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_norm_name
  ON public.customers (public.normalize_org_name(name));

-- 納入先: 取引先の配下で正規化名が一意（別取引先に同名の納入先はあり得るため customer_id 込み）
CREATE UNIQUE INDEX IF NOT EXISTS uq_dest_norm_fullname
  ON public.delivery_destinations (customer_id, public.normalize_org_name(full_name));
