"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = getSupabaseBrowserClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/(backoffice)`,
      },
    });
    if (!error) setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center space-y-4">
          <div className="text-5xl">📧</div>
          <h2 className="text-xl font-bold text-gray-800">メールを確認してください</h2>
          <p className="text-gray-500 text-sm">
            {email} にログインリンクを送りました。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full space-y-6">
        <div className="text-center">
          <div className="text-4xl mb-2">🌿</div>
          <h1 className="text-2xl font-bold text-green-800">農業DX</h1>
          <p className="text-gray-500 text-sm mt-1">スタッフログイン</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@farm.co.jp"
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !email}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl disabled:opacity-50 transition-colors"
          >
            {loading ? "送信中..." : "ログインリンクを送信"}
          </button>
        </form>
      </div>
    </div>
  );
}
