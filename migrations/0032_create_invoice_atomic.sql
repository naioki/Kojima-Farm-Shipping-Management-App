-- ============================================================
-- 0032_create_invoice_atomic.sql
-- 請求書の作成を1トランザクションで行う関数（tax.md: 請求書番号の欠番禁止・二重請求の防止）。
--
-- それまでは アプリ側で「採番 → 請求書INSERT → 明細INSERT → price_status 更新」を別々に実行しており、
-- 途中で失敗すると番号だけ消費されて欠番になった。この関数では全部が成功したときだけ確定し、
-- 失敗したら採番カウンタも含めて丸ごと取り消される（欠番が出ない）。
--
-- 二重請求の防止もこの中で行う: 同じ取引先の請求書作成を取引先単位のロックで直列化し、
-- 明細のいずれかが有効な請求書（void 以外）に既に載っていれば 'already_billed' で中止する。
-- 金額計算（Decimal.js・単価の補完）はアプリ側（lib/invoices/generate.ts）で行い、結果を渡す。
-- 実行は service_role のみ（サーバーの Route Handler 経由）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_invoice_atomic(
  p_customer_id     UUID,
  p_billing_month   TEXT,
  p_period_start    DATE,
  p_period_end      DATE,
  p_issue_date      DATE,
  p_invoice_reg_num TEXT,
  p_subtotal_8      NUMERIC,
  p_tax_8           NUMERIC,
  p_subtotal_10     NUMERIC,
  p_tax_10          NUMERIC,
  p_total_amount    NUMERIC,
  p_created_by      UUID,
  p_items           JSONB
)
RETURNS TABLE (invoice_id UUID, invoice_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_month  TEXT;
  v_seq    INTEGER;
  v_number TEXT;
  v_id     UUID;
  v_dup    INTEGER;
BEGIN
  IF p_billing_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'invalid_billing_month:%', p_billing_month;
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'no_items';
  END IF;

  -- 同じ取引先の請求書作成を直列化（同時に2回押されても二重請求にならない）
  PERFORM pg_advisory_xact_lock(hashtext('create_invoice:' || p_customer_id::text));

  SELECT count(*) INTO v_dup
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
   WHERE i.status <> 'void'
     AND ii.order_item_id IN (
       SELECT (e ->> 'order_item_id')::uuid FROM jsonb_array_elements(p_items) e
     );
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'already_billed:%', v_dup;
  END IF;

  -- 採番（同じトランザクション内なので、以降で失敗すればカウンタも巻き戻る）
  v_month := replace(p_billing_month, '-', '');
  v_seq := public.get_next_invoice_number(v_month);
  v_number := v_month || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.invoices (
    invoice_number, customer_id, billing_month, period_start, period_end, issue_date, invoice_reg_num,
    subtotal_8, tax_8, subtotal_10, tax_10, total_amount, status, created_by
  ) VALUES (
    v_number, p_customer_id, p_billing_month, p_period_start, p_period_end, p_issue_date, p_invoice_reg_num,
    p_subtotal_8, p_tax_8, p_subtotal_10, p_tax_10, p_total_amount, 'draft', p_created_by
  )
  RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, order_item_id, product_name, quantity, unit, unit_price, tax_rate)
  SELECT v_id,
         (e ->> 'order_item_id')::uuid,
         e ->> 'product_name',
         (e ->> 'quantity')::numeric,
         COALESCE(NULLIF(e ->> 'unit', ''), '個'),
         (e ->> 'unit_price')::numeric,
         (e ->> 'tax_rate')::smallint
    FROM jsonb_array_elements(p_items) e;

  -- 請求に載せた明細の単価を「確定」にする
  UPDATE public.order_items
     SET price_status = 'confirmed'
   WHERE id IN (SELECT (e ->> 'order_item_id')::uuid FROM jsonb_array_elements(p_items) e);

  RETURN QUERY SELECT v_id, v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_atomic(UUID, TEXT, DATE, DATE, DATE, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_invoice_atomic(UUID, TEXT, DATE, DATE, DATE, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, TEXT, DATE, DATE, DATE, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, JSONB) TO service_role;
