-- 0034: 収穫タスク（harvest_tasks）を「1明細1件」に固定する
--
-- 背景:
--   harvest_tasks.order_item_id には一意制約が無かった（0014 は検索用の index のみ）。
--   取り込みで承認済みの注文が「要確認」の追加FAXで承認待ちに戻ると、既存の収穫タスクが残ったまま
--   再承認でタスクが追加され、同じ明細に2件以上できることがあった。重複があると数量の同期
--   （maybeSingle）が失敗し続ける。
--   アプリ側は lib/harvest/upsert-tasks.ts（既存があれば更新・無ければ作成）で発生源を止めた。
--   このマイグレーションは (a) 既にできた重複を1行にまとめ、(b) 一意インデックスで再発を防ぐ。
--
-- (a) 重複のまとめ方（同じ order_item_id の行の中から1行を残し、残りを消す）
--   残す行: 実績の進んでいる行を優先する。
--     status の順位 completed(4) > packing(3) > harvesting(2) > delayed(1) > not_started(0)
--     （delayed は「遅れている＝未完了」なので、作業に入った harvesting より下・未着手より上）
--     順位が同じなら新しい行（created_at が新しい → 同じなら updated_at → id で決定的に）。
--   列ごとの扱い（消す行の値を残す行に足すか）:
--     status        … 残す行の値（＝重複の中で最も進んだ値）をそのまま使う。足さない。
--     assigned_to   … 残す行が NULL のときだけ、消す行の担当（進んだ順・新しい順で最初の非NULL）を引き継ぐ。
--     required_qty  … 足さない（重複は同じ明細の必要数を二重に持っていただけで、合計は二重計上になる）。
--                     注文明細の数量 order_items.quantity を正として入れ直す。
--     task_date     … 足せない列。注文の納品日がある場合は「納品日の前日」（engineering.md §3）に
--                     そろえる。納品日が無ければ残す行の値。
--     product_id    … 注文明細の product_id を正とする（NULL なら残す行の値）。
--     created_at    … 残す行の値のまま（書き換えない）。
--     updated_at    … トリガー（set_updated_at）で適用時刻になる。
--   order_item_id が NULL の行（明細に紐づかない手入力タスク）は対象外。触らない。
--
-- (b) 一意インデックス uq_harvest_tasks_order_item_id (order_item_id)
--   Postgres の一意インデックスは NULL 同士を別物として扱う（NULLS DISTINCT が既定）ので、
--   order_item_id が NULL の行は複数あってよい。ON CONFLICT (order_item_id) の対象にもできる。
--   既存の検索用 index idx_harvest_tasks_order_item_id（0014）は残す（ロールバックを単純にするため。
--   一意インデックスと役割が重なるので、落とすなら別のマイグレーションで）。
--
-- 冪等: 重複が無ければ (a) は何もしない。(b) は IF NOT EXISTS。何度流してもよい。
-- 同時実行: 重複をまとめてから一意インデックスを作るまでの間に新しい重複が入らないよう、
--   トランザクション内で表をロックする（SHARE ROW EXCLUSIVE: 読み取りは止めない・書き込みは待たせる）。
--
-- ロールバック:
--   DROP INDEX IF EXISTS uq_harvest_tasks_order_item_id;
--   （(a) で消した重複行は戻らない。必要なら適用前に次でバックアップを取っておく:
--     CREATE TABLE harvest_tasks_backup_0034 AS
--       SELECT * FROM harvest_tasks WHERE order_item_id IN (
--         SELECT order_item_id FROM harvest_tasks WHERE order_item_id IS NOT NULL
--         GROUP BY order_item_id HAVING count(*) > 1);
--   ）
--
-- 適用前の確認（本番）:
--   SELECT order_item_id, count(*) FROM harvest_tasks WHERE order_item_id IS NOT NULL
--     GROUP BY order_item_id HAVING count(*) > 1;

BEGIN;

LOCK TABLE harvest_tasks IN SHARE ROW EXCLUSIVE MODE;

-- (a) 重複のまとめ
-- 残す行・消す行は最初に一度だけ決めて一時表に固定する（UPDATE で updated_at などが変わった後に
-- 並べ直すと、残す行が入れ替わってしまうため）
CREATE TEMP TABLE _harvest_tasks_0034_rank ON COMMIT DROP AS
SELECT
  t.id,
  t.order_item_id,
  t.assigned_to,
  row_number() OVER (
    PARTITION BY t.order_item_id
    ORDER BY
      CASE t.status
        WHEN 'completed'  THEN 4
        WHEN 'packing'    THEN 3
        WHEN 'harvesting' THEN 2
        WHEN 'delayed'    THEN 1
        ELSE 0
      END DESC,
      t.created_at DESC,
      t.updated_at DESC,
      t.id DESC
  ) AS rn,
  count(*) OVER (PARTITION BY t.order_item_id) AS n
FROM harvest_tasks t
WHERE t.order_item_id IS NOT NULL;

DELETE FROM _harvest_tasks_0034_rank WHERE n = 1;

UPDATE harvest_tasks h
SET
  assigned_to  = COALESCE(
                   h.assigned_to,
                   (SELECT d.assigned_to FROM _harvest_tasks_0034_rank d
                     WHERE d.order_item_id = h.order_item_id AND d.rn > 1 AND d.assigned_to IS NOT NULL
                     ORDER BY d.rn LIMIT 1)
                 ),
  required_qty = COALESCE(oi.quantity, h.required_qty),
  product_id   = COALESCE(oi.product_id, h.product_id),
  task_date    = COALESCE(o.delivery_date - 1, h.task_date)
FROM _harvest_tasks_0034_rank k
LEFT JOIN order_items oi ON oi.id = k.order_item_id
LEFT JOIN orders o ON o.id = oi.order_id
WHERE h.id = k.id AND k.rn = 1;

DELETE FROM harvest_tasks h
USING _harvest_tasks_0034_rank r
WHERE h.id = r.id AND r.rn > 1;

-- (b) 一意インデックス（NULL は複数可）
CREATE UNIQUE INDEX IF NOT EXISTS uq_harvest_tasks_order_item_id ON harvest_tasks (order_item_id);

COMMIT;
