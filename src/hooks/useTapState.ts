"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { nextTapState } from "@/lib/utils/tap-state";
import { fieldDb } from "@/lib/offline/db";
import type { MatrixData } from "@/types/database";

export function useTapState(taskId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!navigator.onLine) {
        await fieldDb.outbox.add({
          task_id: taskId,
          type: "tap",
          payload: {},
          created_at: Date.now(),
          retry_count: 0,
        });
        return;
      }
      const res = await fetch(`/api/shipping-tasks/${taskId}/tap`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("tap failed");
    },
    onMutate: async () => {
      // ["shipping-matrix", tenantId, date] の形式に前方一致でキャンセル
      await qc.cancelQueries({ queryKey: ["shipping-matrix"] });

      // 全マトリックスクエリのスナップショットを保存
      const previousEntries = qc.getQueriesData<MatrixData>({
        queryKey: ["shipping-matrix"],
      });

      // Optimistic Update: 全マトリックスクエリを更新
      qc.setQueriesData<MatrixData>({ queryKey: ["shipping-matrix"] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          rows: old.rows.map((r) => {
            if (r.task_id !== taskId) return r;
            const newState = nextTapState(r.tap_state, r.is_partial);
            return {
              ...r,
              tap_state: newState,
              is_partial: newState === 0 ? false : r.is_partial,
              packed_qty: newState === 0 ? null : r.packed_qty,
            };
          }),
        };
      });

      // IndexedDB も楽観的に更新
      await fieldDb.shipping_tasks.where("id").equals(taskId).modify((t) => {
        const ns = nextTapState(t.tap_state, t.is_partial);
        t.tap_state = ns;
        if (ns === 0) {
          t.is_partial = false;
          t.packed_qty = null;
        }
      });

      return { previousEntries };
    },
    onError: (_err, _vars, context) => {
      // ロールバック
      context?.previousEntries?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["shipping-matrix"] });
    },
  });
}
