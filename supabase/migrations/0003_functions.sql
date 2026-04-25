-- =====================================================
-- Postgres 関数: タップループ状態遷移（アトミック操作）
-- =====================================================
CREATE OR REPLACE FUNCTION advance_tap_state(
  p_task_id  UUID,
  p_actor_id UUID
)
RETURNS shipping_tasks
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task shipping_tasks;
  v_old_state SMALLINT;
  v_new_state SMALLINT;
BEGIN
  SELECT * INTO v_task FROM shipping_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  v_old_state := v_task.tap_state;

  -- 未確認の変更通知がある場合: タップで確認（状態遷移はしない）
  IF v_task.has_unack_change THEN
    UPDATE shipping_tasks
    SET has_unack_change = false,
        ack_change_at    = now(),
        acked_by         = p_actor_id,
        updated_at       = now()
    WHERE id = p_task_id
    RETURNING * INTO v_task;

    UPDATE change_notifications
    SET acknowledged_by  = p_actor_id,
        acknowledged_at  = now()
    WHERE shipping_task_id = p_task_id
      AND acknowledged_at IS NULL;

    RETURN v_task;
  END IF;

  -- 通常のタップループ: 0 → 1 → 2 → 0
  IF v_task.is_partial AND v_task.tap_state = 0 THEN
    -- 部分完了状態から「梱包完了」へ
    v_new_state := 1;
    UPDATE shipping_tasks
    SET tap_state  = 1,
        is_partial = false,
        packed_qty = null,
        updated_at = now()
    WHERE id = p_task_id
    RETURNING * INTO v_task;
  ELSIF v_task.tap_state = 0 THEN
    v_new_state := 1;
    UPDATE shipping_tasks
    SET tap_state  = 1,
        updated_at = now()
    WHERE id = p_task_id
    RETURNING * INTO v_task;
  ELSIF v_task.tap_state = 1 THEN
    v_new_state := 2;
    UPDATE shipping_tasks
    SET tap_state  = 2,
        updated_at = now()
    WHERE id = p_task_id
    RETURNING * INTO v_task;
  ELSE
    -- tap_state = 2 → リセット
    v_new_state := 0;
    UPDATE shipping_tasks
    SET tap_state  = 0,
        is_partial = false,
        packed_qty = null,
        updated_at = now()
    WHERE id = p_task_id
    RETURNING * INTO v_task;
  END IF;

  -- 監査ログ
  INSERT INTO audit_logs (tenant_id, actor_id, actor_type, action, resource_type, resource_id, before_data, after_data)
  VALUES (
    v_task.tenant_id,
    p_actor_id,
    'user',
    'task.tap_state_changed',
    'shipping_task',
    p_task_id,
    jsonb_build_object('tap_state', v_old_state),
    jsonb_build_object('tap_state', v_new_state)
  );

  RETURN v_task;
END;
$$;

-- =====================================================
-- 単位換算ヘルパー関数
-- =====================================================
CREATE OR REPLACE FUNCTION convert_unit(
  p_tenant_id  UUID,
  p_product_id UUID,
  p_qty        NUMERIC,
  p_from_unit  TEXT,
  p_to_unit    TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_multiplier NUMERIC;
BEGIN
  SELECT multiplier INTO v_multiplier
  FROM unit_conversion_master
  WHERE tenant_id  = p_tenant_id
    AND product_id = p_product_id
    AND from_unit  = p_from_unit
    AND to_unit    = p_to_unit
    AND effective_to IS NULL
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_multiplier IS NULL THEN
    RAISE EXCEPTION 'No conversion rate found for product=% from=% to=%',
      p_product_id, p_from_unit, p_to_unit;
  END IF;

  RETURN ROUND(p_qty * v_multiplier, 3);
END;
$$;

-- =====================================================
-- 受注承認時にシッピングタスクを自動生成するトリガー
-- =====================================================
CREATE OR REPLACE FUNCTION create_shipping_tasks_on_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- orders.status が confirmed になった場合にタスクを生成
  IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN
    INSERT INTO shipping_tasks (
      tenant_id, order_item_id, order_id, customer_id, product_id,
      delivery_date, assigned_qty
    )
    SELECT
      oi.tenant_id,
      oi.id,
      NEW.id,
      NEW.customer_id,
      oi.product_id,
      NEW.delivery_date,
      COALESCE(oi.revised_qty, oi.converted_qty)
    FROM order_items oi
    WHERE oi.order_id = NEW.id
    ON CONFLICT (order_item_id, delivery_date) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_shipping_tasks
  AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION create_shipping_tasks_on_approve();

-- =====================================================
-- 受注明細の数量変更時に change_notifications を自動生成
-- =====================================================
CREATE OR REPLACE FUNCTION notify_quantity_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task shipping_tasks;
  v_old_qty NUMERIC;
  v_new_qty NUMERIC;
BEGIN
  IF NEW.revised_qty IS NULL OR NEW.revised_qty = OLD.revised_qty THEN
    RETURN NEW;
  END IF;

  v_old_qty := COALESCE(OLD.revised_qty, OLD.converted_qty);
  v_new_qty := NEW.revised_qty;

  -- 該当するシッピングタスクを検索・更新
  UPDATE shipping_tasks
  SET assigned_qty     = v_new_qty,
      has_unack_change = true,
      updated_at       = now()
  WHERE order_item_id = NEW.id
  RETURNING * INTO v_task;

  IF FOUND THEN
    INSERT INTO change_notifications (
      tenant_id, shipping_task_id, order_item_id,
      previous_qty, new_qty, changed_by
    )
    VALUES (
      NEW.tenant_id, v_task.id, NEW.id,
      v_old_qty, v_new_qty, NEW.revised_by
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_quantity_revision
  AFTER UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION notify_quantity_revision();
