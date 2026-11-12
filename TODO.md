# TODO（現在の残タスク）

> 最終更新: 2026-11-12。終わったら消す。履歴は git に残る。
> 設計の正本は `.claude/rules/`、デプロイは [DEPLOY.md](DEPLOY.md)。

## 🔴 運用側でやること（コードでは解決できない）

- [ ] **インボイス登録番号（T番号）を入れる**: `/admin/settings` →「自社情報」。空のままだと請求書が適格請求書の要件を満たさない（法令上必須）
- [ ] **FAX取り込みの合言葉 `FAX_INGEST_TOKEN` を設定**: 設定画面「外部連携のキー」。Kojima-FAX 側と**同じ値を同時に**入れる（未設定だと取り込み口が誰でも使える）
- [ ] **Cloud Scheduler の2ジョブ**（`cron/overdue-shipments`・`cron/cleanup-receipts`）に `x-cron-secret` ヘッダを付ける（`CRON_SECRET` は本番に設定済み）
- [ ] LINE WORKS の Webhook URL を設定（Cloud Run の環境変数で設定済みなら不要）
- [ ] v4 の停止（手順は `docs/retire-v4.md`）

## 🟡 本番DBの未適用マイグレーション

0026 / 0029 の一部が本番に無い（一覧は `.claude/rules/engineering.md` §1）。コードはフォールバックで動いている。
**適用する前に**、退避先（`app_settings` の `v5_destination_routes` など）に溜まった既存データを列へ移す手順を決めること。

## 🟠 2026-11-12 の品質点検で見つかり、まだ直していないもの

レビュー担当がコードで事実確認済み。いずれも今回の変更より前からある。

- [ ] **規定コンテナが保存されないのに「保存しました」と出る**: 本番は `delivery_destinations.default_container_type` 列が無く、`app/api/destinations/[id]/route.ts`（PATCH）と `app/api/destinations/route.ts`（POST）が列なし時に黙って捨てる。退避先を作るか、入力欄を出さない
- [ ] **出荷一覧の上部の進捗が全品目で ÷20**: `components/field/PackingAndShippingViews.tsx:233-238` と `lib/concierge/schema.ts:377`。engineering.md §3 では青梗菜だけの規則。キュウリなど入数が20以外の品目でカードの箱数と食い違う
- [ ] **手入力の注文で `intake_channel` が NULL**: 注文の受付で受注経路を選ばずに登録できる（`components/field/ShipmentAddForm.tsx:2000,2098`）。評価指標④で「不明」に入る
- [ ] **便名の先頭が削られる**: 「17時便」「16時便」「当日便」が「便」になる（`lib/field/shipment-sort.ts:101-110` の `cleanShippingRouteName`）
- [ ] **書き込みの結果を確認していない箇所が残っている**（try で囲んでいないので `tests/no-silent-catch.test.ts` では検知できない）: `app/api/deliveries/confirm-customer/route.ts:79`（本体の更新）、`app/api/orders/[id]/reject/route.ts:68,78`、`app/api/orders/route.ts:569,575,590`、`app/api/order-items/[id]/route.ts:138-146`、`lib/ingestion/process-receipt.ts:1063-1073,1270-1302`
- [ ] `harvest_tasks` に「1明細1件」の一意制約が無い。重複があると数量の同期が毎回警告になる（本番データの修復と制約の追加が要る）
- [ ] `app/api/order-items/[id]/reset` と `app/api/orders/revise` が楽観ロック（`version`）を WHERE に使っていない
- [ ] 承認時の統合は同じ品目の数量を「上書き」する（追加FAXの再送を想定した仕様、`lib/orders/approve.test.ts:113`）。手入力・ポータルの別口の追加注文でも上書きになる点が意図どおりか確認
- [ ] 画面: スマホ幅で右下の追加ボタンがカードの文字に重なる（出荷一覧・配送リスト）／警告トーストが上部のタブに重なる

## 🟢 改善の候補

- [ ] AI相談窓口: タイ語の返答、返答の逐次表示、👎の理由の分析（評価指標ページの「AI相談窓口の品質」が溜まってから）
- [ ] 現場の追加画面: 手入力欄の整理（入力欄が多い）
- [ ] 評価指標ページ: 運用が2〜3週間たまってから、基準値（ベースライン）を決める
- [ ] 他社展開: FAXソフト連携の整理（`docs/` に設計メモ）
