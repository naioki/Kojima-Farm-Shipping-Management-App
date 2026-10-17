# 技術スタック詳細（Cloud Run 一体型）

## アーキテクチャ
```
ユーザー
  ↓
Cloudflare DNS + CDN + WAF（静的キャッシュ・セキュリティ）
  ↓
Google Cloud Run（asia-northeast1）
  └─ Next.js standalone コンテナ 1つ
     ├─ 画面（Server/Client Components）
     └─ API（Route Handlers）← PDF生成・OCR等の重い処理も制限なし
  ↓
Supabase (PostgreSQL) + Cloudflare R2 (ファイル)
```

## Cloud Run 設定
```bash
gcloud run deploy kojima-noen \
  --source . \
  --region asia-northeast1 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \          # コスト優先。体感重視なら 1（約$10/月）
  --max-instances 3 \
  --allow-unauthenticated \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=supabase-key:latest"
```
- タイムアウト: デフォルト300秒（請求書一括生成も余裕）
- secrets は Secret Manager に置く（環境変数直書き禁止）

## next.config.js 必須設定
```js
module.exports = {
  output: 'standalone',  // Cloud Run 用（必須）
  images: { formats: ['image/avif', 'image/webp'] },
}
```

## Dockerfile
リポジトリルートの Dockerfile を使用（マルチステージビルド、node:20-slim, 非root実行）。
変更時は docker build がローカルで通ることを確認する。

## 主要パッケージ
```
next@14, @supabase/supabase-js, @supabase/ssr,
@tanstack/react-query@5, react-hook-form@7, zod@3, @hookform/resolvers,
decimal.js, date-fns@3, lucide-react, recharts,
@tanstack/react-table@8, react-hot-toast, clsx, tailwind-merge
```

## フォント
next/font/google で自己ホスト（CDN <link> 禁止 → CLS・速度改善）:
- Noto Sans JP (400/500/700)
- Zen Old Mincho (700/900) … 見出し用ディスプレイ
- JetBrains Mono (400/600) … 数字・金額・コード

## 環境変数
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY      # Secret Manager
R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY  # Secret Manager
```

## PDF 生成
@react-pdf/renderer をサーバー側（Route Handler）で使用。
Cloud Run はメモリ1Gi・300秒あるため Puppeteer も選択可だがまず @react-pdf で軽量に。
