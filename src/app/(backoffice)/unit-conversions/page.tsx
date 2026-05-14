"use client";

import { useState, useEffect } from "react";

interface Product { id: string; name: string; base_unit: string; }
interface Rule {
  id: string;
  product_id: string;
  from_unit: string;
  to_unit: string;
  multiplier: number;
  notes: string | null;
  effective_from: string;
}

export default function UnitConversionsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [rules, setRules]       = useState<Rule[]>([]);
  const [form, setForm] = useState({ product_id: "", from_unit: "", to_unit: "", multiplier: "", notes: "" });
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState("");

  async function load() {
    const [p, r] = await Promise.all([
      fetch("/api/backoffice/products").then((r) => r.json()),
      fetch("/api/unit-conversions").then((r) => r.json()),
    ]);
    setProducts(p ?? []);
    setRules(r ?? []);
    if (p?.[0] && !form.product_id) setForm((f) => ({ ...f, product_id: p[0].id, to_unit: p[0].base_unit }));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/unit-conversions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, multiplier: Number(form.multiplier) }),
    });
    if (res.ok) {
      setMsg("追加しました");
      setForm((f) => ({ ...f, from_unit: "", multiplier: "", notes: "" }));
      await load();
    } else {
      const d = await res.json();
      setMsg(d.error ?? "エラーが発生しました");
    }
    setSaving(false);
  }

  const selectedProduct = products.find((p) => p.id === form.product_id);

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">⚖️ 単位換算マスタ</h2>
      <p className="text-sm text-gray-500">バラ→箱 など換算レートをここで管理します（ハードコードなし）。</p>

      {/* 追加フォーム */}
      <form onSubmit={handleAdd} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h3 className="font-semibold text-gray-700">換算ルールを追加</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">商品</label>
            <select
              value={form.product_id}
              onChange={(e) => {
                const p = products.find((p) => p.id === e.target.value);
                setForm((f) => ({ ...f, product_id: e.target.value, to_unit: p?.base_unit ?? "" }));
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none"
            >
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">変換元単位</label>
            <input value={form.from_unit} onChange={(e) => setForm((f) => ({ ...f, from_unit: e.target.value }))}
              placeholder="bara" required className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              変換先単位 <span className="text-blue-500">({selectedProduct?.base_unit ?? "base"})</span>
            </label>
            <input value={form.to_unit} onChange={(e) => setForm((f) => ({ ...f, to_unit: e.target.value }))}
              placeholder="box" required className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">掛け率（×元単位 = 先単位）</label>
            <input type="number" step="any" value={form.multiplier}
              onChange={(e) => setForm((f) => ({ ...f, multiplier: e.target.value }))}
              placeholder="0.033333" required className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">メモ</label>
            <input value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="30本/箱" className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none" />
          </div>
        </div>
        {msg && <p className={`text-sm ${msg.includes("エラー") ? "text-red-600" : "text-green-600"}`}>{msg}</p>}
        <button type="submit" disabled={saving}
          className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? "保存中..." : "追加"}
        </button>
      </form>

      {/* 一覧 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              {["商品", "変換元", "掛け率", "変換先", "メモ", "有効開始"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((r) => {
              const p = products.find((p) => p.id === r.product_id);
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-800">{p?.name ?? r.product_id}</td>
                  <td className="px-4 py-3 text-sm font-mono text-purple-700">{r.from_unit}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">× {r.multiplier}</td>
                  <td className="px-4 py-3 text-sm font-mono text-blue-700">{r.to_unit}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{r.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{r.effective_from}</td>
                </tr>
              );
            })}
            {rules.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">換算ルールがありません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
