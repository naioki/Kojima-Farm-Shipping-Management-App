# HANDOFF — 自律実装の引き継ぎ（2026-06-13）

ブランチ: `kn/farm-app-phase-a-g`（main から分岐）。Phase A〜G を1フェーズ1コミットで実装。

## ✅ フル検証パス済み（2026-06-13 追記）

ローカルミラー `C:\dev\kojima-noen`（Drive外・clone）で `npm install` 後、**全工程green**:
- `npm run typecheck` … clean（0 errors）
- `npm run lint` … No ESLint warnings or errors
- `npm run test` … 80 passed
- `npm run build` … ✓ Compiled successfully（10ルート＋middleware 生成）

このとき行った修正（コミット済み）:
- **Supabase 型付け**: `types/supabase.ts`（Database型・手書き）を追加し3クライアントに generic を付与。
  これで Route Handler の `.select()/.insert()` が型検査される。
- **supabase-js を 2.47.10 に固定**: 最新 2.108 は型ジェネリクスが破壊的変更で行が `never` に
  なるため。`@supabase/ssr` も 0.5.2 固定。`package-lock.json` をコミット（再現性確保）。
- googleapis の auth 型、invoices!inner のネスト配列、eslint の `next/typescript` 追加を修正。

➡ 以降、ローカル clone では素直に `npm install` → 上記4コマンドが通る。下の「ブロッカー」は
Drive 直下で作業する場合のみ該当（node_modules を Drive に置けない件は変わらず）。

---

## ⛔ 明日いちばん最初に見てほしいこと（ブロッカー）

**この Google Drive 上のフォルダでは `npm install` / `npm run build` / `npm run lint` /
全体 `tsc` が実行できません。** node_modules を Drive 仮想FSに展開できず（EBADF/EPERM、
ジャンクションも reparse point 非対応で不可）。詳細と恒久対応は `TODO.md` の🔴参照。

➡ **ローカル（非Drive）に clone して検証してください:**
```
git clone <repo> C:\dev\kojima-noen && cd C:\dev\kojima-noen
git checkout kn/farm-app-phase-a-g
npm install
npm run typecheck && npm run lint && npm run test && npm run build
```

自分は代わりに Drive 外の検証用ディレクトリ（`C:\Users\naiok\kojima-verify`）に
ロジックをコピーして `vitest`/`tsc` を回し、**純粋ロジック80件すべて green・型チェック clean**
を確認済み。ただし TSX/Route Handler/外部結合（Supabase/Next/Gemini/IMAP/R2）は
この環境で型チェック・実行できていない（要ローカル検証）。

---

## ✅ 完了したもの（コミット単位）

| フェーズ | 内容 | 検証状態 |
|---|---|---|
| Phase 1 | Next.js/Cloud Run スキャフォールド、`.claude/rules/` 復元、デザインシステム、Modal/Providers | 型は未（要ローカル） |
| **A** | migrations(基盤10＋新規4＋RLS＋生成列＋採番関数)、types/database.ts、parse-quantity、tax | **テスト29・型clean** |
| **B** | dedupe/quota/name-match（純粋）＋ supabase/r2/gemini/config/cron（外部結合） | **純粋21件 green**／外部結合は未実行 |
| **C** | undo 可否・楽観ロック・audit、order-items PATCH/undo、middleware、admin/inbox、KPICard | **純粋10件 green**／API未実行 |
| **D** | 安全版タップループ・不足計算（純粋）、MatrixCell、matrix画面、TaskProgressCard | **純粋15件 green**／UI未実行 |
| **E** | portal/orders API、portal画面、OrderForm（RLSは0002で作成済） | 純粋なし／要RLS実DBテスト |
| **F** | outbox 畳み込み/競合（純粋）、useOutbox(IndexedDB)、manifest | **純粋7件 green** |
| **G** | notify 並列送信・出荷指示（純粋）、invoices/generate API | **純粋10件 green**／API未実行 |

合計テスト: **80 件すべて green**（lib/calculations, receipts, gemini, matching, orders, field,
notify, shipping, offline）。

---

## 🟡 置いた仮定（要確認・あなたの判断が必要）

1. **基盤10テーブルが存在しなかった** → `migrations/0001_base_schema.sql` を新規作成。
   採用したテーブル/型が想定と合うか確認を（特に `customers.closing_rule` を TEXT に。
   締めルールを構造化するなら JSONB 化を相談したい）。詳細は TODO.md🟡。
2. **生成列の式**: Postgres は生成列が別生成列を参照不可のため、tax.md の
   `tax_amount = subtotal*rate/100` を `subtotal` 式をインライン展開して実装（結果は同一）。
3. **users テーブル**は `auth.users` 参照のプロフィールとして定義（Supabase Auth 前提）。
4. **採番**: `get_next_invoice_number` を UPSERT+RETURNING で実装（欠番なし・同時実行に強い）。
   `invoice_counters` テーブルを10テーブル目として追加。
5. **cron 認証**: 簡易に共有シークレット `CRON_SECRET`（ヘッダ）で実装。OIDC を使うなら
   `lib/config/ingestion.ts:verifyCronRequest` を差し替え。
6. **請求期間**: 当面 `delivery_date >= 月初` で集計。`customers.closing_rule` に基づく厳密な
   期間決定は未実装（要件確認後に精緻化）。
7. **依存追加**: vitest/decimal 等に加え、外部結合用に @google/generative-ai, googleapis,
   imapflow, mailparser, @aws-sdk/client-s3(+presigner), idb, @react-pdf/renderer を
   package.json に追加（未インストール＝要ローカル `npm install`）。

---

## 🔧 未解決 TODO（次の作業候補）

- [ ] **ローカルで typecheck/lint/build を通す**（最優先・上記ブロッカー）。TSX/Route Handler に
      型エラーが残っている可能性あり（Supabase の生成型を入れていないため `select(...)` の
      戻り型が緩い箇所がある。`supabase gen types` で `types/database.ts` を補強推奨）。
- [ ] **ポータル RLS を実DBでテスト**（features.md §2-3／失敗#3）。別customerの注文が見えないこと。
- [ ] Phase B 外部結合の疎通: Drive/IMAP/Gemini/R2 の認証情報設定後に poll-* を実行確認。
      `pending_ai` を quota ゲート(canRunGemini)で解析キューに流す部分は TODO コメントで未接続。
- [ ] Phase C inbox: 差分ハイライト・確信度バー・元画像(R2署名URL)表示・ワンタップ承認＋
      delivery_date 必須強制のUIは未実装（バックエンドは下地あり）。
- [ ] Phase D: 複数日グリッド・品目タブ・7日 recharts 棒グラフ・大型テンキー(部分完了)・
      長押しリセットUIは未実装（tap-loop/shortage のロジックは完成・テスト済）。
- [ ] Phase G: @react-pdf/renderer での請求書PDF生成→R2保存、出荷指示書のUI/PDF、
      前日17時の不足予測バッチ(notify)。invoices/generate は draft 作成まで。
- [ ] ログイン画面 `(auth)/login` と Magic Link `/portal/login` 画面が未作成（middleware と
      認証ガードは実装済みだが入口UIが無い）。
- [ ] PWA Service Worker 本体（public/sw.js）と icons は未配置（manifest のみ）。

---

## 📝 検証の再現方法（自分が使った手順）

```
# Drive外に検証ディレクトリ（既に存在: C:\Users\naiok\kojima-verify）
#   - vitest/typescript/decimal.js/zod を devDeps に持つ
#   - tsconfig は paths {"@/*":["./*"]}、vitest は alias '@'→'.'
# 純粋ロジックの lib/** と types/database.ts をコピーして:
cd C:\Users\naiok\kojima-verify
npx tsc --noEmit      # → 0
npx vitest run        # → 80 passed
```
※ あくまでロジック検証用。正本は Drive 上のリポジトリ。本番検証はローカル clone で。

---

## 結論
要件（PROMPT.md / features.md）の **判定・計算の核（壊れると出荷/請求事故になる箇所）は
すべて純粋関数に切り出し、80件のテストで固定済み**。残りは「外部サービスの疎通」と
「UIの作り込み」で、いずれもローカル環境＋認証情報があれば進められる状態です。
まずは TODO.md🔴 のローカル clone での typecheck/build 通しをお願いします。
