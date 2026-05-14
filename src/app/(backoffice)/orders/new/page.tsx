"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Customer { id: string; name: string; code: string; }
interface Product  { id: string; name: string; base_unit: string; price_per_unit: number; }
interface OrderLine {
  product_id: string;
  ordered_qty: number;
  ordered_unit: string;
  unit_price: number;
  preview_qty: number | null; // 換算後
}

export default function NewOrderPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products,  setProducts]  = useState<Product[]>([]);
  const [customerId,    setCustomerId]    = useState("");
  const [deliveryDate,  setDeliveryDate]  = useState("");
  const [notes,         setNotes]         = useState("");
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/backoffice/customers").then((r) => r.json()),
      fetch("/api/backoffice/products").then((r)  => r.json()),
    ]).then(([c, p]) => {
      setCustomers(c ?? []);
      setProducts(p  ?? []);
      if (p?.[0]) addLine(p[0]);
    });

    const d = new Date();
    d.setDate(d.getDate() + 1);
    setDeliveryDate(d.toISOString().slice(0, 10));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addLine(product?: Product) {
    const p = product ?? products[0];
    if (!p) return;
    setLines((prev) => [
      ...prev,
      { product_id: p.id, ordered_qty: 1, ordered_unit: p.base_unit, unit_price: p.price_per_unit, preview_qty: null },
    ]);
  }

  function updateLine(i: number, field: keyof OrderLine, value: string | number) {
    setLines((prev) => {
      const next = [...prev];
      if (field === "product_id") {
        const p = products.find((p) => p.id === value);
        next[i] = { ...next[i], product_id: String(value), ordered_unit: p?.base_unit ?? "", unit_price: p?.price_per_unit ?? 0, preview_qty: null };
      } else {
        (next[i] as any)[field] = value;
      }
      return next;
    });

    // 単位換算プレビュー
    if (field === "ordered_qty" || field === "ordered_unit") {
      const line = lines[i];
      const qty  = field === "ordered_qty" ? Number(value) : line.ordered_qty;
      const unit = field === "ordered_unit" ? String(value) : line.ordered_unit;
      const prod = products.find((p) => p.id === line.product_id);
      if (!prod || unit === prod.base_unit) {
        setLines((prev) => { const n = [...prev]; n[i] = { ...n[i], preview_qty: null }; return n; });
        return;
      }
      fetch("/api/unit-conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: line.product_id, qty, from_unit: unit, to_unit: prod.base_unit }),
      })
        .then((r) => r.json())
        .then((data) => {
          setLines((prev) => {
            const n = [...prev];
            n[i] = { ...n[i], preview_qty: data.converted_qty ?? null };
            return n;
          });
        });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !deliveryDate || lines.length === 0) return;
    setSubmitting(true);
    setError("");

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        delivery_date: deliveryDate,
        notes,
        items: lines.map((l) => {
          const prod = products.find((p) => p.id === l.product_id);
          return {
            product_id:   l.product_id,
            ordered_qty:  l.ordered_qty,
            ordered_unit: l.ordered_unit,
            base_unit:    prod?.base_unit ?? l.ordered_unit,
            unit_price:   l.unit_price,
            tax_rate:     0.08,
          };
        }),
      }),
    });

    if (res.ok) {
      router.push("/(backoffice)/orders");
    } else {
      const data = await res.json();
      setError(data.error ?? "エラーが発生しました");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">➕ 受注手動入力</h2>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-6 space-y-5">
        {/* 得意先 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">得意先 *</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
            >
              <option value="">選択してください</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">納品日 *</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
            />
          </div>
        </div>

        {/* 明細 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">受注明細 *</label>
            <button type="button" onClick={() => addLine()} className="text-sm text-green-600 hover:text-green-700 font-medium">
              ＋ 行追加
            </button>
          </div>

          <div className="space-y-2">
            {lines.map((line, i) => {
              const prod = products.find((p) => p.id === line.product_id);
              return (
                <div key={i} className="flex gap-2 items-center bg-gray-50 px-3 py-2 rounded-lg">
                  <select
                    value={line.product_id}
                    onChange={(e) => updateLine(i, "product_id", e.target.value)}
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none"
                  >
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>

                  <input
                    type="number"
                    value={line.ordered_qty}
                    min={0}
                    step={0.1}
                    onChange={(e) => updateLine(i, "ordered_qty", Number(e.target.value))}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-center focus:outline-none"
                  />

                  <input
                    type="text"
                    value={line.ordered_unit}
                    onChange={(e) => updateLine(i, "ordered_unit", e.target.value)}
                    placeholder="単位"
                    className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none"
                  />

                  {/* 換算プレビュー */}
                  {line.preview_qty !== null && (
                    <span className="text-xs text-blue-600 whitespace-nowrap">
                      → {line.preview_qty} {prod?.base_unit}
                    </span>
                  )}

                  <input
                    type="number"
                    value={line.unit_price}
                    min={0}
                    onChange={(e) => updateLine(i, "unit_price", Number(e.target.value))}
                    placeholder="単価"
                    className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right focus:outline-none"
                  />
                  <span className="text-xs text-gray-400">円</span>

                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0"
                    >×</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 備考 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:outline-none resize-none"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.push("/(backoffice)/orders")}
            className="px-5 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={submitting || !customerId || !deliveryDate || lines.length === 0}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "登録中..." : "受注を登録"}
          </button>
        </div>
      </form>
    </div>
  );
}
