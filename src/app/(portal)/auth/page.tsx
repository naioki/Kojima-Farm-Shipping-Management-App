"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AuthHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("無効なリンクです。");
      setStatus("error");
      return;
    }

    fetch(`/api/magic-links?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.ok) {
          // 認証成功 → 注文フォームへ
          router.replace("/(portal)/order");
        } else {
          const data = await res.json();
          setError(data.error ?? "リンクが無効または期限切れです。");
          setStatus("error");
        }
      })
      .catch(() => {
        setError("ネットワークエラーが発生しました。");
        setStatus("error");
      });
  }, [searchParams, router]);

  if (status === "loading") {
    return (
      <div className="bg-white rounded-2xl p-8 shadow text-center space-y-4">
        <div className="text-4xl animate-spin">⟳</div>
        <p className="text-gray-600">認証中...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-8 shadow text-center space-y-4">
      <div className="text-5xl">❌</div>
      <h2 className="text-xl font-bold text-red-700">認証エラー</h2>
      <p className="text-gray-600 text-sm">{error}</p>
      <a
        href="/(portal)"
        className="inline-block mt-4 px-6 py-2 bg-orange-500 text-white rounded-xl font-medium"
      >
        再度リンクを取得
      </a>
    </div>
  );
}

export default function PortalAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-white rounded-2xl p-8 shadow text-center">
          <div className="text-4xl animate-spin">⟳</div>
        </div>
      }
    >
      <AuthHandler />
    </Suspense>
  );
}
