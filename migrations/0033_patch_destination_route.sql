-- ============================================================
-- 0033_patch_destination_route.sql
-- 出発時刻・便名・規定コンテナの退避ストア（app_settings key='v5_destination_routes'、value は TEXT の
-- JSON オブジェクト）を、キー単位の部分更新で1文で書き換える関数。
--
-- それまでアプリ側（lib/field/destination-routes-store.ts）は「全体を読む → JS でマージ → 全体を upsert」で
-- 保存しており、事務所と現場が同時に保存すると後勝ちで片方の変更が消えうった。この関数は
-- INSERT ... ON CONFLICT DO UPDATE の1文で、行ロックを取ったうえで「いま保存されている値」に対して
-- 指定キーの指定項目だけを足す／消すので、別キー・同じキーの別項目への同時保存はどちらも残る。
--
-- - p_keys  : 更新するキー（'dest:<id>' / 'cust:<id>:<名前>' / 'cust:<id>:default' など）
-- - p_set   : 各キーのエントリに上書きする項目（JSON オブジェクト。値 null も「null を保存」として入る）
-- - p_unset : 各キーのエントリから消す項目名
-- 保存済みの値が JSON として壊れている／オブジェクトでないときは空のオブジェクトから作り直す
-- （アプリ側の従来の挙動と同じ）。キーのエントリがオブジェクトでないときも空から作る。
-- 実行は service_role のみ（サーバーの Route Handler 経由）。
-- ============================================================

-- TEXT を JSON オブジェクトとして読む。壊れている・オブジェクトでない・NULL なら空オブジェクト。
CREATE OR REPLACE FUNCTION public.v5_routes_parse_object(p_raw TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v JSONB;
BEGIN
  IF p_raw IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  BEGIN
    v := p_raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN '{}'::jsonb;
  END;
  IF jsonb_typeof(v) = 'object' THEN
    RETURN v;
  END IF;
  RETURN '{}'::jsonb;
END;
$$;

-- 保存済みの値（TEXT）に、キーごとの部分更新を当てた結果を TEXT で返す。
CREATE OR REPLACE FUNCTION public.v5_routes_merge(
  p_raw   TEXT,
  p_keys  TEXT[],
  p_set   JSONB,
  p_unset TEXT[]
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  WITH base AS (SELECT public.v5_routes_parse_object(p_raw) AS obj)
  SELECT (
    base.obj || COALESCE(
      (
        SELECT jsonb_object_agg(
          k,
          (
            CASE WHEN jsonb_typeof(base.obj -> k) = 'object' THEN base.obj -> k ELSE '{}'::jsonb END
            || COALESCE(p_set, '{}'::jsonb)
          ) - COALESCE(p_unset, ARRAY[]::TEXT[])
        )
        FROM (SELECT DISTINCT k FROM unnest(p_keys) AS u(k) WHERE k IS NOT NULL AND btrim(k) <> '') AS ks
      ),
      '{}'::jsonb
    )
  )::text
  FROM base;
$$;

CREATE OR REPLACE FUNCTION public.patch_destination_route(
  p_keys  TEXT[],
  p_set   JSONB DEFAULT '{}'::jsonb,
  p_unset TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_set IS NOT NULL AND jsonb_typeof(p_set) <> 'object' THEN
    RAISE EXCEPTION 'p_set must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- 1文で更新: 行が無ければ作り、あれば行ロック下で「いまの値」に部分更新を当てる
  INSERT INTO public.app_settings AS s (key, value, is_secret, updated_at)
  VALUES (
    'v5_destination_routes',
    public.v5_routes_merge(NULL, p_keys, p_set, p_unset),
    FALSE,
    now()
  )
  ON CONFLICT (key) DO UPDATE
    SET value = public.v5_routes_merge(s.value, p_keys, p_set, p_unset),
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.v5_routes_parse_object(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v5_routes_parse_object(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v5_routes_parse_object(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.v5_routes_merge(TEXT, TEXT[], JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v5_routes_merge(TEXT, TEXT[], JSONB, TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v5_routes_merge(TEXT, TEXT[], JSONB, TEXT[]) TO service_role;
REVOKE ALL ON FUNCTION public.patch_destination_route(TEXT[], JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patch_destination_route(TEXT[], JSONB, TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_destination_route(TEXT[], JSONB, TEXT[]) TO service_role;
