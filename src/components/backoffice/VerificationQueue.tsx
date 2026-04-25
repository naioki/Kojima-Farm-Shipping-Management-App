"use client";

import { useState } from "react";
import type { OrderVerificationQueue } from "@/types/database";

interface Props {
  items: OrderVerificationQueue[];
}

export function VerificationQueue({ items }: Props) {
  const [selected, setSelected] = useState<OrderVerificationQueue | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  async function handleApprove(item: OrderVerificationQueue) {
    setProcessing(item.id);
    const res = await fetch(`/api/orders/${item.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approved" }),
    });
    if (res.ok) window.location.reload();
    setProcessing(null);
  }

  async function handleReject(item: OrderVerificationQueue) {
    setProcessing(item.id);
    const res = await fetch(`/api/orders/${item.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rejected" }),
    });
    if (res.ok) window.location.reload();
    setProcessing(null);
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl p-12 text-center text-gray-400">
        <div className="text-5xl mb-4">✅</div>
        <p className="text-lg">未処理の検証待ちアイテムはありません</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* リスト */}
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => setSelected(item)}
            className={`bg-white rounded-xl p-4 shadow-sm cursor-pointer border-2 transition-colors ${
              selected?.id === item.id
                ? "border-green-500"
                : "border-transparent hover:border-gray-200"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold ${
                  item.source === "fax"
                    ? "bg-purple-100 text-purple-700"
                    : item.source === "email"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {item.source.toUpperCase()}
              </span>
              {item.ocr_confidence !== null && (
                <span
                  className={`text-xs ${
                    item.ocr_confidence >= 0.9
                      ? "text-green-600"
                      : item.ocr_confidence >= 0.7
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}
                >
                  信頼度: {Math.round(item.ocr_confidence * 100)}%
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400">
                {new Date(item.created_at).toLocaleString("ja-JP")}
              </span>
            </div>

            <div className="text-sm text-gray-600 truncate">
              {item.parsed_data
                ? JSON.stringify(item.parsed_data).slice(0, 80) + "..."
                : "解析中..."}
            </div>

            <div className="flex gap-2 mt-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleApprove(item);
                }}
                disabled={processing === item.id}
                className="flex-1 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                ✓ 承認
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReject(item);
                }}
                disabled={processing === item.id}
                className="flex-1 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg disabled:opacity-50"
              >
                ✗ 却下
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 詳細パネル */}
      {selected && (
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">OCR解析結果</h3>

          {selected.raw_storage_path && (
            <div className="mb-4 border rounded-lg overflow-hidden">
              <img
                src={`/api/storage/${selected.raw_storage_path}`}
                alt="FAX原本"
                className="w-full object-contain max-h-64"
              />
            </div>
          )}

          <div className="bg-gray-50 rounded-lg p-4">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-auto max-h-64">
              {JSON.stringify(selected.parsed_data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
