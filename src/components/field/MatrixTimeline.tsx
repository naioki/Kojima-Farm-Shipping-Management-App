"use client";

import { useState, useMemo } from "react";
import type { MatrixRow } from "@/types/database";
import { TaskCell } from "./TaskCell";
import { useShippingMatrix } from "@/hooks/useShippingMatrix";
import { useRealtimeTaskUpdates } from "@/hooks/useRealtimeTaskUpdates";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function jpWeekday(date: Date): string {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return days[date.getDay()];
}

interface Props {
  tenantId: string;
}

export function MatrixTimeline({ tenantId }: Props) {
  const [startDate, setStartDate] = useState<Date>(new Date());
  const COLS = 7; // 7日分表示

  const dates = useMemo(
    () =>
      Array.from({ length: COLS }, (_, i) => {
        const d = addDays(startDate, i);
        return { iso: formatDate(d), label: `${d.getMonth() + 1}/${d.getDate()}(${jpWeekday(d)})` };
      }),
    [startDate]
  );

  const primaryDate = dates[0].iso;
  const { data: matrixData, isLoading } = useShippingMatrix(tenantId, primaryDate);

  // Supabase Realtime でリアルタイム更新を受信
  useRealtimeTaskUpdates(tenantId, primaryDate);

  // 行のキー生成（顧客×商品の一意な組み合わせ）
  const rowKeys = useMemo(() => {
    if (!matrixData) return [];
    const seen = new Set<string>();
    return matrixData.rows.filter((r) => {
      const key = `${r.customer_id}:${r.product_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [matrixData]);

  function findCell(customerId: string, productId: string, date: string): MatrixRow | null {
    return (
      matrixData?.rows.find(
        (r) => r.customer_id === customerId && r.product_id === productId && r.delivery_date === date
      ) ?? null
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <span className="text-2xl animate-spin mr-3">⟳</span> 読み込み中...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 日付ナビゲーション */}
      <div className="flex items-center gap-2 px-4 py-3 bg-green-700 text-white">
        <button
          onClick={() => setStartDate((d) => addDays(d, -7))}
          className="px-3 py-1 bg-green-600 rounded-lg text-lg font-bold active:bg-green-500"
        >
          ◀
        </button>
        <input
          type="date"
          value={formatDate(startDate)}
          onChange={(e) => setStartDate(new Date(e.target.value))}
          className="px-3 py-1 rounded-lg text-gray-800 text-sm"
        />
        <button
          onClick={() => setStartDate((d) => addDays(d, 7))}
          className="px-3 py-1 bg-green-600 rounded-lg text-lg font-bold active:bg-green-500"
        >
          ▶
        </button>
        <button
          onClick={() => setStartDate(new Date())}
          className="ml-auto px-3 py-1 bg-yellow-400 text-yellow-900 rounded-lg text-sm font-bold active:bg-yellow-300"
        >
          今日
        </button>
      </div>

      {/* マトリックステーブル */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse min-w-full">
          <thead className="sticky top-0 bg-green-100 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-sm font-semibold text-green-900 border border-gray-300 min-w-[160px] sticky left-0 bg-green-100 z-20">
                顧客 / 商品
              </th>
              {dates.map((d) => (
                <th
                  key={d.iso}
                  className="px-2 py-2 text-center text-sm font-semibold text-green-900 border border-gray-300 min-w-[90px]"
                >
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowKeys.length === 0 ? (
              <tr>
                <td
                  colSpan={COLS + 1}
                  className="text-center py-12 text-gray-400 text-lg"
                >
                  この日の出荷予定はありません
                </td>
              </tr>
            ) : (
              rowKeys.map((rowKey) => (
                <tr key={`${rowKey.customer_id}:${rowKey.product_id}`} className="hover:bg-gray-50">
                  <td className="px-3 py-1 border border-gray-200 sticky left-0 bg-white z-10">
                    <div className="text-sm font-semibold text-gray-800 leading-tight">
                      {rowKey.customer_name}
                    </div>
                    <div className="text-xs text-gray-500">{rowKey.product_name}</div>
                  </td>
                  {dates.map((d) => {
                    const cell = findCell(rowKey.customer_id, rowKey.product_id, d.iso);
                    return (
                      <td key={d.iso} className="p-1 border border-gray-200">
                        {cell ? (
                          <TaskCell row={cell} />
                        ) : (
                          <div className="tap-cell bg-gray-50 rounded-lg" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
