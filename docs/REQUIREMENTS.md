# 地域農業DXプラットフォーム — システム要件定義書

**バージョン**: 1.0  
**作成日**: 2026-05-14  
**対象**: 小規模〜中規模農場の出荷管理SaaS

---

## 1. プロジェクト概要

### 1-1. 目的
農場のバックオフィス（受注集計）と圃場（梱包・出荷）の間に存在するコミュニケーションギャップを解消し、農場の利益最大化と経営強化を支援するマルチテナントSaaSを構築する。

### 1-2. ステークホルダー
| 役割 | 説明 |
|---|---|
| **admin** | 農場管理者。全機能アクセス・設定変更権限あり |
| **backoffice** | 事務担当。受注入力・検証・請求書発行を担当 |
| **field** | 現場作業員。圃場タブレットで出荷状況を管理 |
| **customer** | B2B得意先（スーパー等）。ポータルから直接発注 |

---

## 2. 機能要件

### 2-1. 受注チャネル（オムニチャネル）

#### FAX受注
- FAXプロバイダーのWebhookが `POST /api/webhooks/fax-received` を呼び出す
- リクエストは **HMAC-SHA256署名**（`X-Webhook-Signature` ヘッダー）で認証する
- テナント識別は `tenant_slug` パラメータで行い、サーバー側で `tenant_id` に解決する（クライアントから `tenant_id` を直接受け取らない）
- Gemini Vision API（`gemini-2.0-flash`）で画像をOCR解析し、得意先・納品日・商品・数量を JSON で抽出する
- OCR結果は `order_verification_queue` テーブルへ保存し、バックオフィスの承認を待つ
- FAX画像は Supabase Storage の `raw-inputs` バケットに保存する

#### メール受注
- メール転送サービスのWebhookが `POST /api/webhooks/email-received` を呼び出す
- FAXと同様に HMAC-SHA256 で認証する
- Gemini API にメール本文（テキスト）を送り、構造化データを抽出する
- FAXと同様に検証キューへ保存する

#### 手動入力（バックオフィス）
- `/(backoffice)/orders/new` 画面から受注を直接入力する
- 入力時に単位換算プレビュー（バラ→箱 等）をリアルタイム表示する
- 登録後は即座に `status = 'confirmed'` となり圃場に配信される

#### B2Bポータル（直接発注）
- 得意先はメールアドレスを入力するとMagic Link（パスワードレスURL）を受信する
- Magic LinkはSHA-256でハッシュ化したトークンとして `magic_links` テーブルで管理する
- セッションはHttpOnly Cookieに保存し、24時間で失効する
- B2Bポータルからの受注は検証キューをスキップし、即座に `confirmed` になる

#### i-Plus連携
- i-Plus（第三者受注代行）からの受注を `source = 'i_plus'` として管理する
- 設定によって検証キューを経由するか直接承認するかを選択できる（将来実装）

### 2-2. Human-in-the-loop 検証フロー

```
FAX / メール受信
    ↓
order_verification_queue へ保存（status = 'pending'）
    ↓
バックオフィス画面で確認
  ├─ 承認 → orders テーブル作成（status = 'confirmed'）
  │         → DB トリガーで shipping_tasks を自動生成
  └─ 却下 → status = 'rejected'（廃棄）
```

- OCR信頼度（`ocr_confidence`）が低い場合は UI で警告を表示する
- 承認・却下操作は `reviewed_by` / `reviewed_at` として監査ログに記録される

### 2-3. 単位換算マスタ

- **ハードコード禁止**: 全ての換算レートは `unit_conversion_master` テーブルで管理する
- テナントごと・商品ごとに換算レートを設定できる
- `effective_from` / `effective_to` で時系列管理が可能（将来の価格改定等に対応）
- 換算式: `converted_qty = ordered_qty × multiplier`
- 例: きゅうり 60バラ × 0.033333 = 2箱
- バックオフィス画面（`/unit-conversions`）からCRUD操作が可能
- 受注入力フォームでリアルタイムプレビューを提供する

### 2-4. 圃場UI

#### レイアウト
- **マトリックスタイムライン**: 行 = 得意先×商品の組み合わせ、列 = 日付（7日分表示）
- 日付カレンダーボタンで表示開始日を変更できる
- **タブレット最適化**: 最小タップ領域 64px × 80px を確保する
- 複雑なジェスチャー（長押し・スワイプ）は使用しない

#### タップループ状態機械
| tap_state | is_partial | 表示 | 意味 |
|---|---|---|---|
| 0 | false | 白背景 + 目標数量 | 未着手 |
| 1 | false | 緑背景 + ✓ | 梱包完了 |
| 2 | false | グレー背景 + 🚚 | 出荷済み |
| 0 | true | 黄背景 + 実数/目標数 | 部分完了 |

- 状態遷移: 0 → 1 → 2 → 0（ループ）
- 部分完了時: is_partial=true かつ tap_state=0。次タップで tap_state=1（梱包完了）へ
- 状態遷移は Postgres の `advance_tap_state()` 関数がアトミックに実行する（競合防止）

#### 部分数量入力
- 各セルに常に ⌨️ アイコンを表示する
- タップでモーダルを開き、大型テンキー（高齢者・外国人労働者対応）で数量を入力する
- 確定後: is_partial=true、packed_qty = 入力値、tap_state = 0（黄色表示）

### 2-5. リアルタイム同期・変更通知

#### Optimistic UI
- タップ操作はローカルで即座に反映する（サーバー応答を待たない）
- サーバーエラー時はロールバックする
- TanStack Query の `setQueriesData` で全マトリックスクエリを一括更新する

#### バックオフィス→圃場 数量変更通知
1. バックオフィスが `PATCH /api/orders/{orderId}` で `revised_qty` を変更する
2. DB トリガー（`notify_quantity_revision`）が `shipping_tasks.has_unack_change = true` に更新し、`change_notifications` レコードを挿入する
3. Supabase Realtime（PostgreSQL CDC）が変更を即座に圃場タブレットへ配信する
4. 対象セルが **赤点滅**（CSS keyframe アニメーション）し、差分（例: `+10`）を表示する
5. 作業員がタップ → `has_unack_change = false` に更新 → 通常のタップループへ戻る
6. **音声アラートなし**

### 2-6. オフライン対応

#### PWA + Dexie.js
- Service Worker（Workbox）でアプリシェルをキャッシュする
- `shipping_tasks` と得意先・商品マスタを IndexedDB（Dexie.js）にキャッシュする
- ログイン時に当日・翌日のデータを事前取得し最低48時間のオフライン動作を保証する

#### アウトボックスパターン
- オフライン時のタップ操作は `outbox` テーブル（IndexedDB）に積む
- オンライン復帰時に `SyncEngine.flushOutbox()` が順次サーバーへ送信する
- 最大5回リトライし、失敗した操作は `last_error` に記録する

### 2-7. バックオフィス管理機能

| 機能 | 説明 |
|---|---|
| ダッシュボード | 未検証件数・本日受注数・未確認変更通知数のサマリー |
| 受注一覧 | 全受注の一覧表示（チャネル・ステータス・得意先でフィルタ） |
| 検証キュー | FAX/メールのOCR結果確認・承認・却下 |
| 請求書 | 請求書の一覧表示・PDF生成（`@react-pdf/renderer`）・送付管理 |
| 単位換算 | 換算レートの一覧・追加・管理 |

### 2-8. マルチテナント

- 全テーブルに `tenant_id UUID` を付与する
- **Row Level Security（RLS）**: Supabase の PostgreSQL RLS で全テーブルを隔離する
- ヘルパー関数 `get_my_tenant_id()` で `auth.uid()` → `tenant_id` を効率的に解決する
- APIルートはセッションから `tenant_id` を取得し、クライアントから受け取らない
- Storage バケットパスも `{tenant_id}/...` プレフィックスで隔離する

---

## 3. 非機能要件

### 3-1. パフォーマンス
- タップ操作のUI反映: **< 50ms**（Optimistic Update）
- マトリックスデータ初回ロード: **< 2秒**（ネットワーク良好時）
- Gemini OCR処理: **3〜10秒**（非同期処理・202 Accepted を即座に返す）

### 3-2. 可用性
- オフライン時も圃場タブレットが操作可能であること（PWA + IndexedDB）
- 農場の劣悪な通信環境（2G相当）でも基本動作を保証する

### 3-3. セキュリティ
- Webhook は HMAC-SHA256 署名で認証する（`WEBHOOK_SECRET` 環境変数）
- B2B Magic Link は SHA-256 ハッシュを DB に保存し、平文トークンを保持しない
- セッションは HttpOnly + Secure Cookie で管理する
- 全 API は Supabase Auth のJWTで認証する
- RLS によりテナント間のデータ漏洩を DB レベルで防止する
- タイミング攻撃対策として `timingSafeEqual` を使用する

### 3-4. 監査
- 重要な操作（タップ状態変更・受注承認・数量変更）は `audit_logs` テーブルに記録する

---

## 4. データベーススキーマ

### 4-1. テーブル一覧

| テーブル | 主キー | 説明 |
|---|---|---|
| `tenants` | UUID | 農場（テナント）マスタ |
| `users` | UUID (auth.users) | スタッフ（ロール管理） |
| `customers` | UUID | 得意先マスタ |
| `products` | UUID | 商品マスタ（base_unit: 箱単位） |
| `unit_conversion_master` | UUID | 換算レート（バラ→箱等） |
| `magic_links` | UUID | B2B Magic Link 認証トークン |
| `order_verification_queue` | UUID | FAX/メール OCR 検証キュー |
| `orders` | UUID | 受注 |
| `order_items` | UUID | 受注明細（換算済み数量保持） |
| `shipping_tasks` | UUID | 圃場出荷タスク（tap_state管理） |
| `change_notifications` | UUID | バックオフィス→圃場の変更通知 |
| `invoices` | UUID | 請求書 |
| `invoice_items` | UUID | 請求書明細 |
| `audit_logs` | BIGINT | 操作監査ログ |

### 4-2. shipping_tasks の状態定義

```
tap_state = 0, is_partial = false  →  白（未着手）
tap_state = 1, is_partial = false  →  緑（梱包完了）✓
tap_state = 2, is_partial = false  →  グレー（出荷済）🚚
tap_state = 0, is_partial = true   →  黄（部分完了）packed_qty / assigned_qty
has_unack_change = true            →  赤点滅（数量変更通知あり）
```

### 4-3. 主要 Postgres 関数・トリガー

| 名前 | 種別 | 役割 |
|---|---|---|
| `advance_tap_state(task_id, actor_id)` | 関数 | タップ状態遷移（`FOR UPDATE`でアトミック） |
| `convert_unit(tenant_id, product_id, qty, from, to)` | 関数 | 単位換算計算 |
| `get_my_tenant_id()` | 関数 | セッションからテナントID取得（RLS用） |
| `create_shipping_tasks_on_approve` | トリガー | orders.status='confirmed' 時にタスク自動生成 |
| `notify_quantity_revision` | トリガー | revised_qty 変更時に change_notifications 挿入 |

---

## 5. API設計

### 5-1. 圃場API

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/shipping-tasks?delivery_date=` | マトリックスデータ取得 |
| `POST` | `/api/shipping-tasks/{id}/tap` | タップ状態遷移（`advance_tap_state`を呼び出し） |
| `POST` | `/api/shipping-tasks/{id}/partial` | 部分数量設定 |
| `POST` | `/api/shipping-tasks/{id}/ack-change` | 変更通知確認 |

### 5-2. 受注API

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/orders` | 受注一覧 |
| `POST` | `/api/orders` | 受注作成（手動） |
| `GET` | `/api/orders/{id}` | 受注詳細 |
| `PATCH` | `/api/orders/{id}` | 数量変更（→トリガーで通知） |
| `POST` | `/api/orders/{id}/verify` | 検証キュー承認・却下 |

### 5-3. その他

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/webhooks/fax-received` | FAX受信Webhook（HMAC認証） |
| `POST` | `/api/webhooks/email-received` | メール受信Webhook（HMAC認証） |
| `GET/POST/PUT` | `/api/unit-conversions` | 換算マスタ取得・プレビュー計算・追加 |
| `POST/GET` | `/api/magic-links` | Magic Link発行・検証 |
| `GET` | `/api/invoices/{id}/pdf` | PDF生成・ダウンロード（Node.js Runtime） |
| `POST` | `/api/portal/request-link` | 顧客用Magic Link要求 |
| `POST` | `/api/portal/orders` | B2B発注（Magic Linkセッション認証） |

---

## 6. 技術スタック

| レイヤー | 技術 | バージョン | 選定理由 |
|---|---|---|---|
| フロントエンド | Next.js (App Router) | 15 | RSC + CSC 混在、PWA対応、Vercelデプロイ |
| UIスタイル | Tailwind CSS | 3 | タブレット向け素早いUI調整 |
| 状態管理 | TanStack Query | v5 | Optimistic Update内蔵、setQueriesDataで複数クエリ一括更新 |
| バックエンド | Supabase | — | PostgreSQL + Realtime + Auth + Storage の一体型 |
| リアルタイム | Supabase Realtime | — | PostgreSQL CDC (pgoutput) ベース。追加インフラ不要 |
| オフライン | Dexie.js + next-pwa | — | IndexedDB抽象化、Workboxキャッシュ |
| OCR / 解析 | Google Gemini 2.0 Flash | — | Vision (FAX画像) + テキスト (メール本文) 両対応 |
| PDF生成 | @react-pdf/renderer | — | サーバーサイドPDF生成 (Node.js Runtime必須) |
| メール | Resend | — | Magic Link送信、信頼性の高いトランザクションメール |
| ホスティング | Vercel | — | Next.js最適化、Edge + Node.js Runtime選択可能 |

---

## 7. 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | SupabaseプロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase 公開鍵 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase サービスロール鍵（サーバー専用） |
| `GEMINI_API_KEY` | ✅ | Google Gemini API キー |
| `RESEND_API_KEY` | ✅ | Resend APIキー |
| `RESEND_FROM_EMAIL` | ✅ | 送信元メールアドレス |
| `NEXT_PUBLIC_APP_URL` | ✅ | アプリのベースURL（Magic Link生成用） |
| `WEBHOOK_SECRET` | 推奨 | FAX/メールWebhookのHMAC署名秘密鍵 |

---

## 8. ディレクトリ構成（主要ファイル）

```
src/
├── app/
│   ├── (auth)/login/           # スタッフ Magic Link ログイン
│   ├── (backoffice)/           # バックオフィス画面（認証必須）
│   │   ├── page.tsx            # ダッシュボード
│   │   ├── orders/             # 受注一覧・新規入力フォーム
│   │   ├── verification-queue/ # OCR検証キュー
│   │   ├── invoices/           # 請求書・PDF生成
│   │   └── unit-conversions/   # 単位換算マスタCRUD
│   ├── (field)/                # 圃場タブレットUI（認証必須）
│   │   └── page.tsx            # マトリックスタイムライン
│   ├── (portal)/               # B2B顧客ポータル（Magic Link認証）
│   │   ├── page.tsx            # Magic Link要求フォーム
│   │   ├── auth/               # Magic Link検証コールバック
│   │   └── order/              # 発注フォーム
│   └── api/
│       ├── orders/             # 受注CRUD + 数量変更
│       ├── shipping-tasks/     # タップ操作API
│       ├── magic-links/        # Magic Link発行・検証
│       ├── unit-conversions/   # 換算マスタAPI
│       ├── invoices/           # PDF生成API
│       ├── portal/             # 顧客ポータル専用API
│       ├── backoffice/         # マスタデータAPI
│       └── webhooks/           # FAX/メール受信（HMAC認証）
├── components/
│   ├── field/
│   │   ├── MatrixTimeline.tsx  # マトリックス本体
│   │   ├── TaskCell.tsx        # タップループセル
│   │   ├── PartialKeypad.tsx   # 大型テンキーモーダル
│   │   └── OfflineIndicator.tsx
│   └── backoffice/
│       └── VerificationQueue.tsx
├── hooks/
│   ├── useTapState.ts          # Optimistic tap（setQueriesDataで全クエリ更新）
│   ├── usePartialState.ts
│   ├── useAckChange.ts
│   ├── useShippingMatrix.ts    # データ取得 + IndexedDBキャッシュ
│   └── useRealtimeTaskUpdates.ts  # Supabase Realtime購読
├── lib/
│   ├── supabase/{client,server}.ts
│   ├── offline/{db,sync-engine}.ts  # Dexie.js + アウトボックスパターン
│   ├── gemini/{fax-ocr,email-parser}.ts
│   ├── pdf/invoice-template.tsx
│   └── utils/{tap-state,unit-conversion}.ts
└── types/database.ts           # 全テーブルのTypeScript型定義
supabase/migrations/
├── 0001_initial_schema.sql     # 14テーブル
├── 0002_rls_policies.sql       # RLS + Realtime Publication
├── 0003_functions.sql          # Postgres関数・トリガー
└── 0004_seed_dev.sql           # 開発用シードデータ
```

---

## 9. 既知の制限・将来対応事項

| 項目 | 現状 | 将来対応 |
|---|---|---|
| i-Plus連携 | `source='i_plus'` としてデータモデルは対応済み | API連携・CSV取込の実装 |
| 請求書作成 | PDFのみ（手動作成） | 出荷完了後の自動請求書生成 |
| LINE通知 | 未実装 | Magic Link をLINE経由で送信 |
| テスト | 未実装 | Playwright E2E + Vitestユニットテスト |
| 商品・得意先CRUD | APIのみ | バックオフィスCRUD画面 |
| ダッシュボード詳細 | 基本統計のみ | 売上推移グラフ・利益率分析 |
| 納品書PDF | 未実装 | 請求書と同様のテンプレートで実装 |
