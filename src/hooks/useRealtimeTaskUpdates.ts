"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MatrixData, ShippingTask } from "@/types/database";

export function useRealtimeTaskUpdates(tenantId: string, deliveryDate: string) {
  const qc = useQueryClient();
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    const channel = supabase
      .channel(`shipping_tasks:${tenantId}:${deliveryDate}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "shipping_tasks",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const updated = payload.new as ShippingTask;
          if (updated.delivery_date !== deliveryDate) return;

          // 数量変更通知: has_unack_change=true になったセルを更新
          qc.setQueryData<MatrixData>(
            ["shipping-matrix", tenantId, deliveryDate],
            (old) => {
              if (!old) return old;
              return {
                ...old,
                rows: old.rows.map((r) =>
                  r.task_id === updated.id
                    ? {
                        ...r,
                        assigned_qty: updated.assigned_qty,
                        tap_state: updated.tap_state,
                        is_partial: updated.is_partial,
                        packed_qty: updated.packed_qty,
                        has_unack_change: updated.has_unack_change,
                      }
                    : r
                ),
              };
            }
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, deliveryDate, qc, supabase]);
}
