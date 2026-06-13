-- 0006: 現場メモ（field_note）
-- 目的: パック/出荷を中断したときや、現場で何か起きたときの記録を残す。
--   - shipped_qty（既存・0002）= 中断時に「できた数」を記録する部分完了の数値
--   - field_note（本マイグレーション）= 現場側の自由記述メモ（例:「第3ハウス不調で20個で中断」）
--     ※ line_note（0005）は事務→現場への“指示”。field_note は現場→事務への“報告”で役割が異なる。
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS field_note TEXT;

COMMENT ON COLUMN order_items.field_note IS '現場メモ（中断理由・気づき等。現場→事務の報告）';
