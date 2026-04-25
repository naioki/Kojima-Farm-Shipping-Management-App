import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-green-50 flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-green-800">🌿 農業DX</h1>
          <p className="mt-2 text-gray-600 text-sm">地域農業DXプラットフォーム</p>
        </div>

        <nav className="space-y-3">
          <Link
            href="/(backoffice)"
            className="block w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white text-center rounded-xl font-medium transition-colors"
          >
            バックオフィス管理画面
          </Link>
          <Link
            href="/(field)"
            className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white text-center rounded-xl font-medium transition-colors"
          >
            圃場タブレット画面
          </Link>
          <Link
            href="/(portal)"
            className="block w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white text-center rounded-xl font-medium transition-colors"
          >
            B2B顧客ポータル
          </Link>
        </nav>
      </div>
    </main>
  );
}
