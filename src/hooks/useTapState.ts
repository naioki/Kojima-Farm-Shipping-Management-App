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
        // オフライン: アウトボックスへ積む
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
      await qc.cancelQueries({ queryKey: ["shipping-matrix"] });
      const previous = qc.getQueryData<MatrixData>(["shipping-matrix"]);

      // Optimistic Update: ローカルで即座に状態を更新
      qc.setQueryData<MatrixData>(["shipping-matrix"], (old) => {
        if (!old) return old;
        return {
          ...old,
          rows: old.rows.map((r) =>
            r.task_id === taskId
              ? {
                  ...r,
                  tap_state: nextTapState(r.tap_state, r.is_partial),
                  is_partial: r.tap_state === 1 ? false : r.is_partial,
                  packed_qty:
                    nextTapState(r.tap_state, r.is_partial) === 0
                      ? null
                      : r.packed_qty,
                }
              : r
          ),
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

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(["shipping-matrix"], context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["shipping-matrix"] });
    },
  });
}
