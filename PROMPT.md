# Claude Code 統合実装プロンプト — Kojima Farm Shipping Management App

> このファイルをそのまま Claude Code に貼る、または `PROMPT.md` として置いて
> 「PROMPT.md に従って進めて」と指示する。

---

## 0. 前提・コンテキスト

リポジトリ: `Kojima-Farm-Shipping-Management-App`
農業法人（5.2ha・千葉県旭市）の受注・請求・現場タスクを一元管理する B2B Webアプリ。
**売上1億→3億円を支援する基幹システム。ITは手段、利益最大化と現場負担最小化が目的。**

まず以下を**必ず順に読んでから**着手すること:
1. `CLAUDE.md`
2. `.claude/rules/` 全ファイル（stack / structure / design / tax / security / **features**）
3. 既存コンポーネント（`components/ui/` の Button / Input / Card / Select / Skeleton）

既存ルールと衝突した場合は **既存ルールが優先**。本プロンプトは features.md を実装に落とすための
進め方の指示であり、設計の正本は `.claude/rules/features.md`。

---

## 1. 絶対に守る制約（違反したら作り直し）

### アーキテクチャ
- **Cloud Run 一体型**（Next.js 14+ App Router, standalone）。独立した Python/FastAPI を作らない。
- OCR・差分解析・PDF生成・集計はすべて **Next.js Route Handlers** 内で処理。
- 既存FAX受信（自作FastAPI）はリポジトリ外の別サービス。Drive にファイルを置く前提だけ使う。

### データ
- 既存10テーブルに**並列スキーマを作らない**。features.md の統合方針に従い、新規は
  `order_receipts` / `customer_product_rules` / `harvest_estimates` / `gemini_usage_log` の**4つのみ**。
- 変更履歴・Undoは**既存 `audit_log` の上に構築**（新テーブルを作らない）。
- SQL は手書き migrations のみ。新テーブルは**RLSポリシーを同時に**作成（security.md）。

### 金額・税（tax.md を厳守。1円のズレも不可）
- 税率は `order_items` / `invoice_items` に**冗長保持**。`products.default_tax_rate` で計算しない。
- 金額計算は **Decimal.js**。浮動小数点演算禁止。
- `subtotal / tax_amount / line_total` は **GENERATED列**。
- 税率は **8 か 10 のみ**（CHECK制約）。請求書番号は**欠番なし採番**。
- すべての請求書変更を `audit_log` に記録（7年保存）。

### コーディング
- TypeScript `strict: true`、`any` 禁止。全API入力は **Zod** バリデーション。
- Server Components デフォルト、`'use client'` 最小限。`service_role` キーはサーバー専用ファイルのみ。
- 日本語変数名OK。コメントは「なぜ・いつ」を書く。

### UI（design.md「大地と信頼」を厳守）
- 色は **CSS Variables のみ**（hex直書き禁止）。フォントは next/font 自己ホスト（CDN禁止）。
- 金額・数値は `font-mono` + `tabular-nums`。タップターゲット **48px**（畑での親指/手袋操作）。
- 色だけで情報を伝えない（アイコン＋テキスト併用）。WCAG 2.1 AA。

---

## 3. 実装順（フェーズ）

### Phase A — 基盤（最優先）
1. migrations: 新規4テーブル＋既存カラム追加（features.md §1のDDLに準拠）＋各テーブルRLS同時作成
2. `types/database.ts`: 全テーブルの型（strict・Decimal型・Zod schema）
3. `lib/calculations/parse-quantity.ts`: スマートパース（**最重要**）
   - `"15c2"` = 15ケース+端数2 → `15 * packs_per_case + 2`
   - **`x` の後の数字は箱数ではなく「合計個数」**（絶対ルール）
   - 空欄保存はその日の出荷レコード削除
   - 総数 ÷ container_capacity = コンテナ数 … 端数
   - Decimal.js 使用、浮動小数点禁止
4. `lib/calculations/parse-quantity.test.ts`: Vitest 単体テスト

### Phase B — 受注取り込み
（poll-drive / poll-email / Gemini analyze / quota / 重複再送判定）

### Phase C — admin 検証画面
（inbox / 差分ハイライト / 楽観ロック / Undo）

### Phase D — 圃場マトリックス
（安全版タップループ / 部分完了 / 日付期間 / 不足アラート）

### Phase E — B2Bポータル（Magic Link）

### Phase F — オフライン同期＋リアルタイム

### Phase G — 通知・出荷指示・請求接続

> 詳細は `.claude/rules/features.md` を正本とする。

---

## 5. 進め方のルール

- **Phase A から順に**。各フェーズで動くものを作り、`npm run typecheck` `npm run lint`
  （テストがあれば `npm run test`）を通してからコミット。
- 大きな設計判断で迷ったら**実装前に質問**。憶測で進めない。
- migrations は**ロールバック可能**な単位で分割。RLSポリシーは新テーブルと同一PRで。
- 1コミット1目的。コミットメッセージに「なぜ」を書く。
- 環境変数・秘密情報をコードに埋め込まない（Secret Manager / .env.local のみ）。
