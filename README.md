# 小島農園 受注・圃場・請求アプリ（kojima-noen）

紙のFAX・メール・電話に散らばっていた農産物の受注を一本化し、**受注 → 検証 → 圃場（収穫・出荷）→ 請求**までを
1つの画面でつなぐ、小島農園のための業務アプリです。Google Cloud Run 上の Next.js 一体型で動きます。

> 設計の中心思想：**「OCRが必要なのは紙とメール画像だけ」**。B2Bポータルと手動入力は最初から構造化データなので
> AIを通しません。これが Gemini 無料枠の枯渇対策の核であり、ポータルが普及するほどコストが下がります。

---

## 目次

- [何ができるか](#何ができるか)
- [画面構成（3つのサーフェス）](#画面構成3つのサーフェス)
- [ホーム画面（管理ダッシュボード）](#ホーム画面管理ダッシュボード)
- [写真からマスタ一括取込（OCR）](#写真からマスタ一括取込ocr)
- [技術スタック / アーキテクチャ](#技術スタック--アーキテクチャ)
- [ディレクトリ構成](#ディレクトリ構成)
- [セットアップ（ローカル開発）](#セットアップローカル開発)
- [環境変数・シークレット](#環境変数シークレット)
- [よく使うコマンド](#よく使うコマンド)
- [デプロイ（Cloud Run）](#デプロイcloud-run)
- [セキュリティ方針](#セキュリティ方針)
- [テスト](#テスト)

---

## 何ができるか

| 業務フェーズ | 機能 |
|---|---|
| **受注** | 4チャネル受信（FAX→Drive / メール IMAP / B2Bポータル / 手動入力）→ Gemini解析 → 承認待ちキュー |
| **検証** | 確信度ハイライト・差分（再送）検知・取引先名寄せ・承認・Undo（楽観ロック付き） |
| **圃場** | 圃場マトリックス（タップループ安全版・部分完了・不足アラート・オフラインoutbox） |
| **請求** | 出荷確定 → 価格確定（後決め）→ 請求書（インボイス対応・欠番なし採番）・納品書 PDF |
| **マスタ** | 取引先・品目・価格/荷姿（P/C・換算）管理、**写真からの一括取込（OCR）** |
| **設定** | 自社情報・規格ロック・現場機能の段階解放・AIモデル・取り込み・通知（Discord/LINE WORKS）など |

金額・税率・請求番号は `.claude/rules/tax.md` のルールを厳守（税率冗長保持・GENERATED列・Decimal.js・欠番なし採番）。

---

## 画面構成（3つのサーフェス）

| サーフェス | ルート | 対象 | 特徴 |
|---|---|---|---|
| 管理（経営） | `/admin` | 経営陣 | 高密度・俯瞰。サイドバーは業務フェーズでグルーピング |
| 現場（スタッフ） | `/field` | 現場 | スマホ/タブレット最優先。タップ操作・大きいターゲット |
| B2Bポータル | `/portal` | 取引先 | Magic Link 認証・「いつものセット」・RLSで自社分のみ |

---

## ホーム画面（管理ダッシュボード）

`/admin` を開くと最初に表示される、その日の経営判断の起点になる画面です（[app/(dashboard)/admin/page.tsx](app/(dashboard)/admin/page.tsx)）。
上から **「今日の状況」→「いま手を打つこと」→「次の操作」** の順に、視線が自然に流れるよう構成しています。

1. **ヘッダー**：「ダッシュボード」見出しと、右上の常設ボタン **［注文を新規入力］**（電話注文などをその場で入力）。

2. **本日の出荷状況**（KPIカード4枚・当日 `delivery_date` 基準で集計）
   - **未着手** / **梱包完了**（青）/ **出荷済み**（緑）の件数
   - **進捗 %**（出荷済み ÷ 全明細）をプログレスバー付きで表示
   - 明細があれば「出荷一覧で詳細確認 →」で当日の現場画面へ

3. **要対応**（該当があるときだけ赤バッジ付きで出現）
   - **承認待ちの注文** → 承認すると収穫タスクを生成（`/admin/approvals`）
   - **未処理の受信** → AI解析済み・要確認の受信ログ（`/admin/inbox`）
   - **解析失敗 / 取引先未紐付け** → 手動で確認・紐付け（`/admin/inbox?status=ai_failed`）
   - 0件のときはこのセクション自体を出さず、ノイズを減らします。

4. **よく使う操作**：注文の新規入力 / 取引先・規格管理 / 請求書 へのショートカット。

> 設計意図：朝イチで開いたとき「今日どれだけ出るか」「放置してはいけないものは何か」が一目で分かり、
> 次のアクションにワンタップで移れること。数値は等幅数字（tabular-nums）で桁を揃え、色だけでなくアイコン＋
> テキストで状態を伝えています（WCAG AA）。

---

## 写真からマスタ一括取込（OCR）

紙の取引先一覧・品目台帳・規格表を**撮影するだけ**で、店舗（取引先）・品目・規格/荷姿をまとめて登録できます
（管理者専用 `/admin/master-import`）。受注明細OCRとは独立した専用モジュールです。

```
写真を選ぶ(最大6枚) → AIで読み取る → 確認・編集（重複は折りたたみ）→ チェックした分だけ登録
```

- **AI**：Gemini を生 `fetch` で呼び、`responseSchema` + `temperature:0` で構造化抽出。
  設定の **AIモデル** を最優先に、混雑(429/503)・未提供(404)時のみ新→古の順で自動フォールバック。
- **取り込み前圧縮**：ブラウザ側で最大1600px / JPEG品質0.8に圧縮してから送信（通信量・トークン節約）。
- **重複判定（名寄せ）**：NFKC正規化＋空白除去＋小文字化で、表記ゆれ（全角半角・かな/カナ）を吸収。
  既存マスタと重複しそうなものは **チェックOFF＋折りたたみ**、新規は **チェックON＋展開** で提示。
- **Human-in-the-loop**：全項目その場で編集可。確信度60%未満は ⚠要確認 を明示。各セクションに「すべて選択/解除」。
- **安全に登録**：品目 → 規格（必要なら品目を自動作成）→ 取引先 の順。ユニーク制約違反はスキップ扱い、
  想定外エラーは全体を止めず `errors[]` に記録して継続（部分登録の混乱を防止）。

関連：[lib/gemini/master-import.ts](lib/gemini/master-import.ts) / [lib/master-import/dedupe.ts](lib/master-import/dedupe.ts) /
[components/admin/MasterImportWizard.tsx](components/admin/MasterImportWizard.tsx)

---

## 技術スタック / アーキテクチャ

```
ユーザー
  ↓
Cloudflare DNS + CDN + WAF
  ↓
Google Cloud Run（asia-northeast1）
  └─ Next.js 14 standalone コンテナ 1つ
     ├─ 画面（Server / Client Components）
     └─ API（Route Handlers）← PDF生成・OCR等の重い処理もここ
  ↓
Supabase (PostgreSQL + RLS) + Cloudflare R2（ファイル原本）
```

- **フレームワーク**：Next.js 14（App Router・`output:'standalone'`）/ TypeScript strict
- **DB/認証**：Supabase（`@supabase/supabase-js` は **2.47.10 固定**。最新系は型が壊れるため上げない）
- **データ取得**：@tanstack/react-query 5 / フォーム react-hook-form 7 + zod 3
- **計算**：decimal.js（金額・税は浮動小数点禁止）/ 日付 date-fns 3
- **UI**：Tailwind（CSS Variables・デザイントークン）/ lucide-react / recharts / react-hot-toast
- **AI**：Gemini（受注OCRは SDK、マスタ一括取込は生fetch+responseSchema）
- **PDF**：@react-pdf/renderer（Route Handler 内）

詳細は `.claude/rules/`（stack.md / structure.md / security.md / design.md / features.md / tax.md）を参照。

---

## ディレクトリ構成

```
app/
  (auth)/login/                 ログイン（社内=password / ポータル=Magic Link）
  (dashboard)/
    admin/                      経営サーフェス（ダッシュボード・承認・請求・マスタ・設定…）
    field/                      現場サーフェス（出荷一覧・圃場マトリックス）
  portal/                       B2Bポータル（取引先）
  api/                          Route Handlers（OCR・差分・PDF・cron・各CRUD）
components/  ui/ admin/ field/ layouts/ …
lib/         supabase/(client/server/admin)  gemini/  calculations/  pricing/
             master-import/  settings(-spec).ts  notify/  validators/ …
migrations/  DDL（基盤10テーブル + 受注4テーブル + RLS + 生成列）
types/       database.ts（Zod）/ supabase.ts（手書き Database 型）
Dockerfile / .dockerignore / next.config.js
```

---

## セットアップ（ローカル開発）

> ⚠️ **重要**：このリポジトリは Google ドライブ上にあり、ドライブ直下では `npm install` / `build` / `lint` が
> ファイルロック等で失敗します。**ローカルにクローンして検証してください**（例：`C:\dev\kojima-noen`）。

```bash
git clone https://github.com/naioki/kojima-farm-task-manager.git
cd kojima-farm-task-manager
npm ci
cp .env.example .env.local   # 値を埋める（なければ下記キーを手で作成）
npm run dev                   # http://localhost:3000
```

---

## 環境変数・シークレット

秘密情報は **コードに直書きせず**、本番は **Secret Manager**、ローカルは `.env.local` に置きます。

```
# 公開可
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY

# サーバ専用（秘密）
SUPABASE_SERVICE_ROLE_KEY
R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
GEMINI_API_KEY
CRON_SECRET
DISCORD_WEBHOOK_URL / LINE_WORKS_WEBHOOK_URL
```

多くの設定は **設定画面（`/admin/settings`）からDBに保存**でき、解決は「DB → 環境変数」の順
（[lib/settings.ts](lib/settings.ts) / [lib/settings-spec.ts](lib/settings-spec.ts)）。
APIキーなど `secret` 指定の項目は、画面では値を返さず「設定済み/未設定」だけ表示します。
**AIモデル**は設定画面のプルダウンから選択でき、「自動」で新しいモデルから順に試します。

---

## よく使うコマンド

```bash
npm run dev          # 開発サーバ
npm run build        # 本番ビルド（standalone）
npm run lint         # ESLint（CIは --max-warnings=0）
npx tsc --noEmit     # 型チェック
npx vitest run       # ユニットテスト
```

---

## デプロイ（Cloud Run）

```bash
gcloud run deploy kojima-noen \
  --source . \
  --region asia-northeast1 \
  --memory 1Gi --cpu 1 \
  --min-instances 0 --max-instances 3 \
  --allow-unauthenticated \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=supabase-key:latest,GEMINI_API_KEY=gemini-key:latest"
```

- リポジトリルートの `Dockerfile`（マルチステージ・node:20-slim・非root `USER node`）でビルドします。
- タイムアウトは既定300秒（請求書一括生成・OCRも余裕）。シークレットは必ず Secret Manager 経由で。
- 取り込み cron（Drive/メール）は Cloud Scheduler から OIDC + `CRON_SECRET` で呼び出します。

---

## セキュリティ方針

- 全テーブルに **RLS** を有効化。新テーブルはポリシーも同時作成。
- すべての Route Handler で **Zod バリデーション** ＋ `getUser()` 認証チェック（`getSession` 単独は信用しない）。
- `service_role` キーは **`lib/supabase/admin.ts` のみ**。`'use client'` から import 禁止。
- Gemini APIキーは URL クエリではなく `x-goog-api-key` ヘッダで送信（ログ漏洩防止）。
- セキュリティヘッダー（`X-Content-Type-Options` / `X-Frame-Options` / HSTS）は middleware で付与。

詳細は [.claude/rules/security.md](.claude/rules/security.md)。

---

## テスト

判定・計算の核は純粋関数に切り出し、ユニットテストで固定しています
（スマートパース・税計算・名寄せ・重複判定・Undo・タップループ・不足・通知・出荷指示・オフラインなど）。

```bash
npx vitest run     # 全テスト
```

> 誤解釈が出荷ミス・請求ミスに直結するため、`lib/calculations/parse-quantity.ts` 等は変更時にテスト必須です。
