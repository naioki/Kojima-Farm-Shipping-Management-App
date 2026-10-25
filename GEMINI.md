# 小島農園 受発注DXシステム — AIコーディング規約 (GEMINI.md)

## 1. 最優先原則（高品質 × 省トークン）
- **最小読取・直接修正**: 推測や冗長な探索を避け、対象ファイルをピンポイントで読んで直接修正する。別モデル向けの指示書生成ではなく、自分が直接コードを修正・検証・デプロイする。
- **本番DB（0026未適用・RLS環境）の絶対ルール**:
  - サーバー側APIルートおよび管理画面Server ComponentでのDB更新・マスタ参照は、認証確認（`requireAdmin` または `isStaffUser`）のうえ必ず `createAdminClient()` を使用する（`createClient()` だとスタッフ操作や `app_settings` 更新がRLSで弾かれる）。
  - `delivery_destinations` の拡張カラム（`departure_time`, `shipping_route_name`, `pack_sort_order`, `default_container_type`）や `daily_container_inventory` テーブルは、未適用環境エラー（`42703` / `PGRST205` / `42P01`）時に必ず基本カラムへのフォールバックおよび `app_settings` ストア（`v5_destination_routes`, `v5_container_inv:*`, `v5_pack_sort_order`）へ自動退避する。
  - `orders.shipping_time` には `'am' | 'pm'` の CHECK 制約があるため、時刻文字列（`'11:30'` 等）を直接書き込まず `lib/field/destination-routes-store.ts`（`v5_destination_routes`）に保存する。

## 2. マスタ削除・編集の鉄則
- 品目（`/api/products/[id]`）・取引先（`/api/customers/[id]`）・納入先（`/api/destinations/[id]`）の `DELETE` は、409エラーで拒否しない：
  - 注文・請求実績が0件なら、付随する子テーブル（`pack_configs`, `price_rules`, `customer_product_rules` 等）を自動クリーンアップして物理削除する。
  - 過去の注文・請求実績がある場合は、履歴保護のため自動的に `is_active: false`（非表示・アーカイブ）に更新して `200 OK` を返す。

## 3. AI受発注解析（Gemini）の省トークン・高精度設計 ＆ 前日収穫・パック原則
- **全品目「出荷日の前日に収穫・パック」の原則**: すべての品目・取引先において、収穫およびパック（袋詰め）作業は出荷日（`delivery_date`）の前日（-1日）に行う（`harvest_tasks.task_date = shiftDateStr(delivery_date, -1)`）。
- **二重送信禁止**: `lib/gemini/prompts.ts` には全社共通のコア指示・JSONスキーマのみを置き、取引先別ルールは Supabase `ai_rules` テーブル（高密度5ルール）から `systemInstruction` に1回だけ注入する（`parts` 側には絶対に入れない）。
- **決定論的検算**: 入数換算（標準20／NSK24／勘兵衛ケース×20）・箱数切り上げ・固定書式・注文キー生成は `lib/gemini/analyze.ts`（`verifyAndNormalizeItem`）と `lib/pipeline/schemas.ts` で決定論的に算出する。
- **青梗菜の進捗箱数計算ルール（収穫コンテナ40入・ニコイチ20入思想）**:
  - 収穫コンテナには40パック入り、それを「ニコイチ」（20パック/箱）で箱詰め・配送する現場運用に基づき、青梗菜のパック進捗（ヘッダー・追従バー・進捗メーター）の目標箱数および残り箱数は、取引先別の個別入数にかかわらず一律 **`Math.ceil(総パック数 / 20)`** で決定論的に算出する（※作業画面UI上には「40入る/ニコイチ」等の内部理由は表示しない）。

## 4. 検証・デプロイ手順
1. 検証: `npm run typecheck` / `npm run lint` / `npm test`（Vitest）
2. 本番デプロイ: `git push origin main` 後、`powershell -File scripts\deploy.ps1 -SkipChecks` で Cloud Run（`kojima-farm-order-app`）へ反映する。
