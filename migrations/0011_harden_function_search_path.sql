-- 0011: 関数の search_path を固定（Supabase セキュリティ診断 0011_function_search_path_mutable 対策）
-- いずれも SECURITY DEFINER ではないが、role 依存の可変 search_path を固定し経路注入の余地を無くす。
-- 挙動は不変:
--   is_admin / set_updated_at … 本体は auth.*（修飾済）と組込関数のみ → 空 search_path で安全
--   採番2関数 … 本体が未修飾の *_counters(public) を参照 → pg_catalog, public に固定

ALTER FUNCTION public.is_admin() SET search_path = '';
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.get_next_invoice_number(text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_next_delivery_note_number(text) SET search_path = pg_catalog, public;
