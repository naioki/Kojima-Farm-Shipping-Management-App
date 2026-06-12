# TODO / 未解決事項

> 自律実装中に判明した、人間の判断・環境対応が必要な項目。

## 🔴 環境（最優先・ブロッカー）

### node_modules を Google Drive 上に置けない
- **症状**: `npm install` がプロジェクト直下（`G:\マイドライブ\...\node_modules`）で失敗する
  （`EBADF` / `EPERM` / `TAR_ENTRY_ERROR`）。ジャンクション/シンボリックリンクも
  Google Drive 仮想FS が reparse point 非対応のため不可（`New-Item -ItemType Junction` →
  "Incorrect function"）。
- **影響**: この場所では `next build` / `next lint` / 全体 `tsc --noEmit` を実行できない。
- **暫定対応（実施済み）**: ロジック検証用に Drive 外 `C:\Users\naiok\kojima-verify` を作り、
  `lib/calculations/*` と `types/database.ts` をコピーして `vitest` / `tsc` を実行。
  → **Phase A は 29 tests green・typecheck clean を確認済み**。
- **恒久対応（人間がやること）**: ローカル（非Drive）に clone して開発する。例:
  ```
  git clone <repo> C:\dev\kojima-noen
  cd C:\dev\kojima-noen && npm install
  npm run typecheck && npm run lint && npm run test && npm run build
  ```
  Drive 上は「編集・git・閲覧」専用にし、ビルド/インストールはローカルで行う運用を推奨。

## 🟡 Phase A の仮定（要確認）

- **基盤10テーブルが存在しなかった**ため `migrations/0001_base_schema.sql` を新規作成した。
  features.md は「既存10テーブル」を前提にしていたが、リポジトリに migrations が無かった。
  → 採用したカラム型・テーブル構成（users/customers/products/orders/order_items/
  harvest_tasks/invoices/invoice_items/audit_log/invoice_counters）が実際の想定と
  合っているか確認してください。特に `customers.closing_rule`（締めルール）の表現を
  現状 `TEXT default 'month_end'` にしている（JSONB 化が必要なら要相談）。
- **生成列の式**: Postgres は生成列が別の生成列を参照できないため、tax.md の
  `tax_amount = subtotal * tax_rate/100` を `subtotal` の式をインライン展開して実装した
  （計算結果は同一）。
- `users` は `auth.users` 参照のプロフィールテーブルとして定義（Supabase Auth 前提）。

## 🟢 後続フェーズ（B〜G）で外部依存のため未検証の箇所
- Phase B: Drive API / IMAP / Gemini は実認証情報が無いと動作確認不可（コードは実装、
  実行時検証は未）。環境変数・Secret Manager 設定後に疎通確認が必要。
- Phase E: ポータル RLS は **実DBで必ずテスト**（features.md §2-3 / 失敗パターン#3）。
- Phase F: PWA / IndexedDB / Realtime はブラウザ実機での確認が必要。

## メモ
- 全体 typecheck/lint/test/build はローカル clone で実行のこと（上記ブロッカー参照）。
  → 2026-06-13 に C:\dev\kojima-noen で4工程すべて green を確認済み（HANDOFF.md 参照）。
    supabase-js は 2.47.10 に固定（2.108 は型破壊的変更で行が never になる）。
