-- 配送 Phase 1: スタッフ（加瀬・神原）が荷造り場で出発前チェック・配送完了を
-- 記録できるように、deliveries への INSERT/UPDATE を認証済みユーザーに開放する。
-- 状態遷移（planned→loaded→delivered）の妥当性検証は API 側で行う
-- （/api/deliveries/confirm。order_items.field_status 更新と同じ方針）。
CREATE POLICY staff_insert ON deliveries FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY staff_update ON deliveries FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
