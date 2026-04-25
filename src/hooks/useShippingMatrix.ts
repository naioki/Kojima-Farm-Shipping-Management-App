"use client";

import { useQuery } from "@tanstack/react-query";
import type { MatrixData } from "@/types/database";
import { fieldDb } from "@/lib/offline/db";

async function fetchMatrix(
  tenantId: string,
  deliveryDate: string
): Promise<MatrixData> {
  const res = await fetch(
    `/api/shipping-tasks?tenant_id=${tenantId}&delivery_date=${deliveryDate}`
  );
  if (!res.ok) throw new Error("Failed to fetch matrix");
  return res.json();
}

async function getMatrixFromCache(deliveryDate: string): Promise<MatrixData | null> {
  const tasks = await fieldDb.shipping_tasks
    .where("delivery_date")
    .equals(deliveryDate)
    .toArray();

  if (tasks.length === 0) return null;

  return {
    delivery_date: deliveryDate,
    rows: tasks.map((t) => ({
      task_id: t.id,
      customer_id: t.customer_id,
      customer_name: t.customer_name,
      product_id: t.product_id,
      product_name: t.product_name,
      delivery_date: t.delivery_date,
      assigned_qty: t.assigned_qty,
      tap_state: t.tap_state,
      is_partial: t.is_partial,
      packed_qty: t.packed_qty,
      has_unack_change: t.has_unack_change,
      unack_delta: t.unack_delta,
    })),
  };
}

export function useShippingMatrix(tenantId: string, deliveryDate: string) {
  return useQuery({
    queryKey: ["shipping-matrix", tenantId, deliveryDate],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = await getMatrixFromCache(deliveryDate);
        if (cached) return cached;
        throw new Error("オフライン: キャッシュがありません");
      }

      const data = await fetchMatrix(tenantId, deliveryDate);

      // IndexedDB キャッシュを更新
      const now = Date.now();
      for (const row of data.rows) {
        await fieldDb.shipping_tasks.put({
          id: row.task_id,
          tenant_id: tenantId,
          order_item_id: "",
          order_id: "",
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          product_id: row.product_id,
          product_name: row.product_name,
          delivery_date: row.delivery_date,
          assigned_qty: row.assigned_qty,
          tap_state: row.tap_state,
          packed_qty: row.packed_qty,
          is_partial: row.is_partial,
          has_unack_change: row.has_unack_change,
          unack_delta: row.unack_delta,
          updated_at: new Date().toISOString(),
          _synced_at: now,
        });
      }

      return data;
    },
    staleTime: 30_000, // 30秒
    retry: (failureCount) => failureCount < 2,
  });
}
