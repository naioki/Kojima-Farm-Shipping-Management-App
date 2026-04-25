"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fieldDb } from "@/lib/offline/db";
import type { MatrixData } from "@/types/database";

export function usePartialState(taskId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ packed_qty }: { packed_qty: number }) => {
      if (!navigator.onLine) {
        await fieldDb.outbox.add({
          task_id: taskId,
          type: "partial",
          payload: { packed_qty },
          created_at: Date.now(),
          retry_count: 0,
        });
        return;
      }
      const res = await fetch(`/api/shipping-tasks/${taskId}/partial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packed_qty }),
      });
      if (!res.ok) throw new Error("partial update failed");
    },
    onMutate: async ({ packed_qty }) => {
      await qc.cancelQueries({ queryKey: ["shipping-matrix"] });
      const previous = qc.getQueryData<MatrixData>(["shipping-matrix"]);

      qc.setQueryData<MatrixData>(["shipping-matrix"], (old) => {
        if (!old) return old;
        return {
          ...old,
          rows: old.rows.map((r) =>
            r.task_id === taskId
              ? { ...r, is_partial: true, packed_qty, tap_state: 0 }
              : r
          ),
        };
      });

      await fieldDb.shipping_tasks.where("id").equals(taskId).modify((t) => {
        t.is_partial = true;
        t.packed_qty = packed_qty;
        t.tap_state = 0;
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
