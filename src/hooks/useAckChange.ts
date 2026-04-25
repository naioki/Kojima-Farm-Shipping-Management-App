"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fieldDb } from "@/lib/offline/db";
import type { MatrixData } from "@/types/database";

export function useAckChange(taskId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!navigator.onLine) {
        await fieldDb.outbox.add({
          task_id: taskId,
          type: "ack_change",
          payload: {},
          created_at: Date.now(),
          retry_count: 0,
        });
        return;
      }
      const res = await fetch(`/api/shipping-tasks/${taskId}/ack-change`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("ack failed");
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["shipping-matrix"] });
      const previous = qc.getQueryData<MatrixData>(["shipping-matrix"]);

      qc.setQueryData<MatrixData>(["shipping-matrix"], (old) => {
        if (!old) return old;
        return {
          ...old,
          rows: old.rows.map((r) =>
            r.task_id === taskId
              ? { ...r, has_unack_change: false, unack_delta: null }
              : r
          ),
        };
      });

      await fieldDb.shipping_tasks.where("id").equals(taskId).modify((t) => {
        t.has_unack_change = false;
        t.unack_delta = null;
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
