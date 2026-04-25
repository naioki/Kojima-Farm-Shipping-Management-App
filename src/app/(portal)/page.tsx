"use client";

import { useState } from "react";

export default function PortalEntryPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError("");

    // メールアドレスから顧客を検索してMagic Linkを送信
    const res = await fetch("/api/portal/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (res.ok) {
      setSent(true);
    } else {
      const data = await res.json();
      setError(data.error ?? "エラーが発生しました");
    }
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow text-center space-y-4">
        <div className="text-5xl">📧</div>
        <h2 className="text-xl font-bold text-gray-800">メールを送信しました</h2>
        <p className="text-gray-600 text-sm">
          {email} にログインリンクを送信しました。
          メールのリンクをクリックしてご注文ください。
        </p>
        <p className="text-xs text-gray-400">リンクの有効期限は24時間です。</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-8 shadow space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-2">🛒</div>
        <h2 className="text-xl font-bold text-gray-800">ご注文ポータル</h2>
        <p className="text-gray-500 text-sm mt-1">
          メールアドレスを入力するとログインリンクをお送りします
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            メールアドレス
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@company.co.jp"
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {error && (
          <p className="text-red-600 text-sm">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !email}
          className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl disabled:opacity-50 transition-colors"
        >
          {loading ? "送信中..." : "ログインリンクを送信"}
        </button>
      </form>
    </div>
  );
}
