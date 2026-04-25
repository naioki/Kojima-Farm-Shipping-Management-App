"use client";

import { useState } from "react";

interface Props {
  taskId: string;
  assignedQty: number;
  currentPacked: number | null;
  onConfirm: (packed: number) => void;
  onClose: () => void;
}

export function PartialKeypad({
  assignedQty,
  currentPacked,
  onConfirm,
  onClose,
}: Props) {
  const [input, setInput] = useState(
    currentPacked !== null ? String(currentPacked) : ""
  );

  function press(val: string) {
    if (val === "DEL") {
      setInput((prev) => prev.slice(0, -1));
    } else if (val === "." && input.includes(".")) {
      return;
    } else {
      setInput((prev) => (prev.length < 6 ? prev + val : prev));
    }
  }

  function handleConfirm() {
    const n = parseFloat(input);
    if (!isNaN(n) && n >= 0) {
      onConfirm(Math.min(n, assignedQty));
    }
  }

  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "DEL"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-80 overflow-hidden">
        {/* ヘッダー */}
        <div className="bg-yellow-400 px-6 py-4 text-center">
          <p className="text-sm text-yellow-900 font-medium">梱包済み数量を入力</p>
          <p className="text-xs text-yellow-800 mt-1">目標: {assignedQty}</p>
        </div>

        {/* 表示エリア */}
        <div className="px-6 py-4 bg-gray-50 text-right">
          <span className="text-4xl font-mono font-bold text-gray-800">
            {input || "0"}
          </span>
          <span className="text-gray-500 ml-2">/ {assignedQty}</span>
        </div>

        {/* テンキー */}
        <div className="grid grid-cols-3 gap-2 p-4">
          {keys.map((key) => (
            <button
              key={key}
              onClick={() => press(key)}
              className={`
                h-14 rounded-xl text-xl font-bold transition-all active:scale-95
                ${key === "DEL"
                  ? "bg-red-100 text-red-700 active:bg-red-200"
                  : "bg-gray-100 text-gray-800 active:bg-gray-200"
                }
              `}
            >
              {key === "DEL" ? "⌫" : key}
            </button>
          ))}
        </div>

        {/* アクションボタン */}
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <button
            onClick={onClose}
            className="h-14 rounded-xl bg-gray-200 text-gray-700 font-bold text-lg active:bg-gray-300"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={!input || parseFloat(input) < 0}
            className="h-14 rounded-xl bg-yellow-400 text-yellow-900 font-bold text-lg active:bg-yellow-500 disabled:opacity-50"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
