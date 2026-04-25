"use client";

import { useState, useCallback } from "react";
import type { MatrixRow } from "@/types/database";
import { getCellStyle, formatDelta } from "@/lib/utils/tap-state";
import { PartialKeypad } from "./PartialKeypad";
import { useTapState } from "@/hooks/useTapState";
import { usePartialState } from "@/hooks/usePartialState";
import { useAckChange } from "@/hooks/useAckChange";

interface Props {
  row: MatrixRow;
}

export function TaskCell({ row }: Props) {
  const [showKeypad, setShowKeypad] = useState(false);
  const tapMutation = useTapState(row.task_id);
  const partialMutation = usePartialState(row.task_id);
  const ackMutation = useAckChange(row.task_id);

  const cellStyle = getCellStyle(
    row.tap_state,
    row.is_partial,
    row.has_unack_change,
    row.unack_delta
  );

  const handleCellTap = useCallback(() => {
    if (row.has_unack_change) {
      // 数量変更通知の確認タップ
      ackMutation.mutate();
      return;
    }
    tapMutation.mutate();
  }, [row.has_unack_change, tapMutation, ackMutation]);

  const handleKeypadOpen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowKeypad(true);
    },
    []
  );

  const handlePartialConfirm = useCallback(
    (packed: number) => {
      partialMutation.mutate({ packed_qty: packed });
      setShowKeypad(false);
    },
    [partialMutation]
  );

  const isMutating =
    tapMutation.isPending ||
    partialMutation.isPending ||
    ackMutation.isPending;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${row.customer_name} ${row.product_name} ${row.assigned_qty}`}
        onClick={handleCellTap}
        onKeyDown={(e) => e.key === "Enter" && handleCellTap()}
        className={`
          tap-cell relative flex flex-col items-center justify-center
          border border-gray-200 rounded-lg cursor-pointer
          transition-colors duration-150 select-none
          ${cellStyle.bgClass}
          ${isMutating ? "opacity-70 pointer-events-none" : ""}
        `}
      >
        {/* 状態アイコン */}
        {cellStyle.icon && (
          <span className="text-2xl leading-none">{cellStyle.icon}</span>
        )}

        {/* 数量表示 */}
        {row.is_partial && row.packed_qty !== null ? (
          <span className="text-sm font-bold text-yellow-900">
            {row.packed_qty} / {row.assigned_qty}
          </span>
        ) : row.has_unack_change ? (
          <span className="text-lg font-extrabold text-white">
            {formatDelta(row.unack_delta)}
          </span>
        ) : (
          !cellStyle.icon && (
            <span className="text-base font-semibold text-gray-700">
              {row.assigned_qty}
            </span>
          )
        )}

        {/* 部分入力ボタン（キーボードアイコン）: 変更通知中は非表示 */}
        {!row.has_unack_change && (
          <button
            onClick={handleKeypadOpen}
            className="absolute bottom-1 right-1 text-xs text-gray-400 hover:text-gray-700 p-0.5 leading-none"
            aria-label="部分数量入力"
            tabIndex={-1}
          >
            ⌨️
          </button>
        )}
      </div>

      {showKeypad && (
        <PartialKeypad
          taskId={row.task_id}
          assignedQty={row.assigned_qty}
          currentPacked={row.packed_qty}
          onConfirm={handlePartialConfirm}
          onClose={() => setShowKeypad(false)}
        />
      )}
    </>
  );
}
