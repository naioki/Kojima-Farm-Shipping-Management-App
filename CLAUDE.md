# 小島農園 受注ダッシュボード

FAX・メール・電話・取引先ポータルで届く受注を取り込み、承認 → 出荷 → 価格確定 → 請求まで
つなぐ社内システム。管理者（経営）／現場スタッフ／取引先（発注ポータル）の3ロールで使う。

## Quick Facts

- **Stack**: Next.js 14 (App Router) / TypeScript / Supabase (Postgres + Auth + RLS) / Tailwind CSS
- **AI**: Google Gemini（FAX・メール本文のOCR/構造化）
- **外部連携**: Google Drive・IMAP（自動取り込み）/ Cloudflare R2（原本ファイル保存）
- **本番**: Google Cloud Run（サービス名 `kojima-farm-order-app`）。詳細は [DEPLOY.md](DEPLOY.md)
- **Test**: `npm run test`（vitest、Jestではない）
- **Lint**: `npm run lint`
- **Typecheck**: `npm run typecheck`
- **Build**: `npm run build`

## 詳細ルールの参照先

このファイルは全体像のみ。詳細な業務仕様・設計判断は `.claude/rules/` を参照する
（コード内コメントも「features.md §7-8」のように該当箇所を指している）:

- `.claude/rules/features.md` — 業務フロー・機能仕様（受注〜請求の各フェーズ）
- `.claude/rules/design.md` — デザインシステム・UI原則
- `.claude/rules/security.md` — 認証・RLS・シークレット管理
- `.claude/rules/stack.md` — 技術構成の詳細
- `.claude/rules/structure.md` — ディレクトリ構成・ナビ設計
- `.claude/rules/tax.md` — 税率・金額計算のルール

## 環境の注意（重要）

このリポジトリが Google Drive 同期フォルダ配下にある場合、`node_modules` を Drive 上に
展開できず `npm install` / `npm run build` が失敗することがある（EBADF/EPERM、ジャンクションも
reparse point 非対応で不可）。**ビルド・依存インストールは非同期フォルダのローカルcloneで行うこと。**
Drive上は編集・閲覧・git専用にする。

## ロールとナビの構造

- **admin（管理者/経営）**: `app/(dashboard)/admin/**`。サイドバー定義は `components/layouts/nav-items.ts`
  の `ADMIN_GROUPS`。全ページ `lib/auth/require-admin.tsx` の `requireAdmin()` でガードする
  （未認証は `/login`、admin以外は `ErrorState`）。新しい `/admin/*` ページを追加するときは
  必ず先頭で `const guard = await requireAdmin('...'); if (guard) return guard` を呼ぶこと。
- **staff（現場）**: `app/field/**`。下部固定バー（`FieldBottomBar`）＋ハンバーガーメニューが主動線。
  管理者機能の解放状態は `lib/field/features.ts`（設定 → 現場機能の解放）で制御。
- **customer（取引先ポータル）**: `app/portal/**`。Magic Link認証。RLSで自分の
  `customer_id` に紐づく注文のみ見える。

## 業務ドメインの核となるルール

- **表示は常に「取引先 ＞ 納入先」**（`delivery_destinations`。1取引先に複数納入先がありうる、
  和郷園コープが典型例）。納入先単独では出さない。取引先一覧・詳細・出荷一覧・承認・納品書の
  どこに新しい画面を作っても、この表示ルールを踏襲する。
- **承認ゲート**（`app/api/orders/[id]/approve/route.ts`）: 納品日に加え、納入先（複数登録が
  ある取引先）・荷姿(`pack_configs`、登録がある商品)が未確定だと承認できない。出荷一覧に来た
  時点で箱数・納入先が必ず計算・表示できる状態を保証するためのゲート。
- **楽観ロック**: `order_items.version` を使い、PATCHは `WHERE id=$ AND version=$expected`。
  0件なら409（競合）でUIに再読込を促す。新しい編集APIを作るときはこのパターンに従う。
- **スナップショット凍結**: 請求書(`invoices`)・納品書(`delivery_notes`)は発行時点の内容を
  別テーブルに複製して保持する。元データ（`order_items`・設定）を後で変更しても過去の帳票は
  変わらない。
- **荷姿(pack_configs)と価格(price_rules)は別マスタ**。荷姿=総数→箱数の換算基準、価格=期間×
  取引先の単価。過去の請求・出荷実績には遡及しない。
- **NEVER swallow errors**: 一覧・詳細ページはエラー時に必ず `<ErrorState message={...} />` を
  返す（サイレント失敗しない）。空状態は必ず `<EmptyState />`。

## デプロイ

`git push` だけでは本番に反映されない（デプロイトリガー未設定）。手動で
`gcloud builds submit --config=cloudbuild.yaml --substitutions=...` を実行する必要がある
（コマンド全体は [DEPLOY.md](DEPLOY.md) 参照）。デプロイ後は必ずトラフィックが
`--to-latest` になっているか確認する（過去に特定リビジョンへの固定が残り、新デプロイが
反映されない事故があった）。

## マイグレーション

`migrations/*.sql` に連番で追加する（ORM無し・手書きSQL）。追加したら本番Supabase
（Supabase MCP経由）にも忘れず適用する。型は `types/database.ts` に手動で追従させる
（`supabase gen types` は未導入）。

## Git Conventions

- コミットメッセージは日本語で簡潔に、変更の理由（why）を書く
- 破壊的な変更（DB直接操作・force push・シークレット関連）は必ず確認を取ってから実行する
