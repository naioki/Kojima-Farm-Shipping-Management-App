'use client'

/**
 * ルートレイアウト自体が壊れたときの最終防衛線。
 * ここでは外部コンポーネント・フォント・CSS変数に依存しない（それらが壊れている可能性があるため）。
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0, background: '#faf9f7', color: '#1a1410' }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 420 }}>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>システムエラーが発生しました</h2>
          <p style={{ fontSize: 14, color: '#7a6854', marginBottom: 8 }}>
            再試行しても直らない場合は、時間をおいて再度アクセスしてください。
          </p>
          {error?.digest && (
            <p style={{ fontSize: 12, color: '#7a6854', marginBottom: 16 }}>エラーID: {error.digest}</p>
          )}
          <button
            onClick={() => reset()}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#b8935d', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
          >
            再試行
          </button>
        </div>
      </body>
    </html>
  )
}
