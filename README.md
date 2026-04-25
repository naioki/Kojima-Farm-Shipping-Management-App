# 地域農業DXプラットフォーム（SaaS）

農場の出荷管理を一元化するマルチテナントSaaSアプリケーション。

## 概要

FAX・メール・B2Bポータル・手動入力で受け付けた受注を集約し、圃場タブレットへリアルタイムで配信。バックオフィスと現場の断絶を解消します。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | Next.js 15 (App Router) + TypeScript + Tailwind CSS |
| バックエンド/DB | Supabase (PostgreSQL + Realtime + Auth + Storage) |
| AI/OCR | Google Gemini 2.0 Flash (Vision) |
| オフライン | Dexie.js (IndexedDB) + PWA (next-pwa) |
| 状態管理 | TanStack Query v5 + Zustand |
| PDF生成 | @react-pdf/renderer |
| メール送信 | Resend |
| ホスティング | Vercel + Supabase Cloud |

## 主要機能

### 受注チャネル
- **FAX**: Gemini Vision API でOCR解析 → 人間検証 → 圃場配信
- **メール**: Gemini API でテキスト解析 → 人間検証 → 圃場配信
- **B2Bポータル**: Magic Link（パスワードレス）認証 → 直接圃場配信
- **手動入力**: バックオフィス画面から即時登録

### 圃場UI（タブレット最適化）
- **マトリックスタイムライン**: 行=顧客/商品、列=日付
- **タップループ**: 白（未着手）→ 緑✓（梱包完了）→ グレー🚚（出荷済）→ 白（リセット）
- **部分完了**: ⌨️ をタップして大型テンキーで部分数量入力（黄色表示）
- **オフラインファースト**: 圏外でもタップ操作可能、接続回復後に自動同期

### リアルタイム変更通知
- バックオフィスが数量変更 → 圃場セルが赤点滅 + 差分表示（例: `+10`）
- ワーカーがタップして確認 → 通常のタップループに戻る（音声アラートなし）

## セットアップ

### 環境変数
```bash
cp .env.local.example .env.local
# 各値を設定してください
```

### インストール・起動
```bash
npm install
npm run dev
```

### Supabase マイグレーション
```bash
npx supabase db push
```

## ディレクトリ構成

```
src/
├── app/
│   ├── (auth)/        # スタッフログイン
│   ├── (backoffice)/  # バックオフィス管理画面
│   ├── (field)/       # 圃場タブレットUI
│   ├── (portal)/      # B2B顧客ポータル
│   └── api/           # APIルート
├── components/
│   ├── field/         # 圃場UIコンポーネント（MatrixTimeline, TaskCell等）
│   ├── backoffice/    # バックオフィスコンポーネント
│   └── portal/        # ポータルコンポーネント
├── lib/
│   ├── supabase/      # Supabaseクライアント（browser/server）
│   ├── offline/       # Dexie.js + SyncEngine（オフライン対応）
│   ├── gemini/        # Gemini API統合（FAX OCR / メール解析）
│   └── pdf/           # @react-pdf/renderer テンプレート
├── hooks/             # カスタムReactフック（useTapState等）
└── types/             # TypeScript型定義
supabase/
├── migrations/        # DBマイグレーションSQL（0001〜0004）
└── config.toml        # Supabaseローカル設定
```

## データベース主要テーブル

| テーブル | 用途 |
|---|---|
| `tenants` | 農場（テナント）マスタ |
| `users` | スタッフ（admin/backoffice/field） |
| `customers` | 得意先マスタ |
| `products` | 商品マスタ |
| `unit_conversion_master` | 単位換算レート（バラ→箱等、DBマスタ管理） |
| `magic_links` | B2Bポータル Magic Link 認証トークン |
| `order_verification_queue` | FAX/メール OCR 人間検証キュー |
| `orders` | 受注（マルチテナント、RLS適用） |
| `order_items` | 受注明細（単位換算済） |
| `shipping_tasks` | 圃場出荷タスク（tap_state 0/1/2） |
| `change_notifications` | バックオフィス→圃場 数量変更通知 |
| `invoices` / `invoice_items` | 請求書（PDF生成対応） |
| `audit_logs` | 操作監査ログ |
