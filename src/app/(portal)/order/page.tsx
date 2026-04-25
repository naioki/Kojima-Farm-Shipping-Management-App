"use client";

import { useState, useEffect } from "react";

interface Product {
  id: string;
  name: string;
  base_unit: string;
  price_per_unit: number;
}

interface OrderLine {
  product_id: string;
  ordered_qty: number;
  ordered_unit: string;
}

export default function PortalOrderPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([{ product_id: "", ordered_qty: 1, ordered_unit: "" }]);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/portal/products")
      .then((r) => r.json())
      .then((data) => {
        setProducts(data ?? []);
        if (data?.[0]) {
          setLines([{ product_id: data[0].id, ordered_qty: 1, ordered_unit: data[0].base_unit }]);
        }
      });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDeliveryDate(tomorrow.toISOString().slice(0, 10));
  }, []);

  function updateLine(i: number, field: keyof OrderLine, value: string | number) {
    setLines((prev) => {
      const next = [...prev];
      if (field === "product_id") {
        const p = products.find((p) => p.id === value);
        next[i] = { ...next[i], product_id: String(value), ordered_unit: p?.base_unit ?? "" };
      } else {
        (next[i] as any)[field] = value;
      }
      return next;
    });
  }

  function addLine() {
    const p = products[0];
    setLines((prev) => [
      ...prev,
      { product_id: p?.id ?? "", ordered_qty: 1, ordered_unit: p?.base_unit ?? "" },
    ]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch("/api/portal/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delivery_date: deliveryDate, items: lines, notes }),
    });

    if (res.ok) {
      setSubmitted(true);
    } else {
      alert("送信に失敗しました。もう一度お試しください。");
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow text-center space-y-4">
        <div className="text-5xl">✅</div>
        <h2 className="text-xl font-bold text-green-700">ご注文を受け付けました</h2>
        <p className="text-gray-500 text-sm">
          納品日 {deliveryDate} のご注文が完了しました。
        </p>
        <button
          onClick={() => { setSubmitted(false); setLines([{ product_id: products[0]?.id ?? "", ordered_qty: 1, ordered_unit: products[0]?.base_unit ?? "" }]); }}
          className="px-6 py-2 bg-orange-500 text-white rounded-xl font-medium"
        >
          続けて注文
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 shadow space-y-5">
      <h2 className="text-xl font-bold text-gray-800">🛒 ご注文</h2>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">納品希望日</label>
        <input
          type="date"
          value={deliveryDate}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDeliveryDate(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
        />
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">商品・数量</label>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={line.product_id}
              onChange={(e) => updateLine(i, "product_id", e.target.value)}
              required
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              type="number"
              value={line.ordered_qty}
              min={1}
              onChange={(e) => updateLine(i, "ordered_qty", Number(e.target.value))}
              required
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-orange-400 focus:outline-none"
            />
            <span className="text-sm text-gray-500 w-8">{line.ordered_unit}</span>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => removeLine(i)}
                className="text-red-400 hover:text-red-600 text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          className="text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          ＋ 商品を追加
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="特記事項があればご記入ください"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !deliveryDate || lines.some((l) => !l.product_id)}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl disabled:opacity-50 transition-colors"
      >
        {loading ? "送信中..." : "注文を確定する"}
      </button>
    </form>
  );
}
