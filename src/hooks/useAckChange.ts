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

      const previousEntries = qc.getQueriesData<MatrixData>({
        queryKey: ["shipping-matrix"],
      });

      qc.setQueriesData<MatrixData>({ queryKey: ["shipping-matrix"] }, (old) => {
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

      return { previousEntries };
    },
    onError: (_err, _vars, context) => {
      context?.previousEntries?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["shipping-matrix"] });
    },
  });
}
