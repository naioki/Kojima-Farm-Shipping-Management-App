# フェーズ2設計書: v4アプリ統合と「シンプル×詳細」同居アーキテクチャ

**Status**: Approved-pending（設計提示段階）
**Date**: 2026-07-04
**前提**: フェーズ1（供給先の系列表記）完了済み
- v4: `customers.supplier_name` 追加・表示リゾルバ集約・帳票適用（本番DB適用済み）
- 本アプリ: 取引先ヨーク（納入先9店舗）・寺崎をシード済み（migrations/0017、本番適用済み）

---

## 1. 目的と非目標

### 目的
1. **2アプリ並行稼働の解消**: kojima-farm-app-v4（Next.js 16 + FastAPI/Python）と本アプリ
   （Next.js 14 一体型）を本アプリに一本化し、保守コスト・デプロイ事故リスク
   （リポジトリとCloud Run実体の乖離が実際に発生した）を排除する。
2. **現場が愛用するシンプルさの死守**: 注文票的な見やすさ・迷わない操作を絶対に損なわない。
3. **機能の選択式・同居**: ラベル発行・OCR検証などの詳細機能は「必要な人に必要なときだけ」
   見える。全員の画面に全機能を並べない。

### 非目標
- v4のUIをそのまま移植すること（機能の意味論を移植する。見た目は本アプリのdesign.mdに従う）
- 過去データの完全移行（§6。凍結参照で足りる履歴は移行しない）
- 新しい実験的技術の導入（既存スタック＋実績のあるOSSのみ。新規依存は原則ゼロ）

---

## 2. 統合方針の決定

### 2-1. 母体は本アプリ（Kojima-Farm-Shipping-Management-App）

| 判断軸 | 本アプリ | v4 |
|---|---|---|
| ドメインモデル | **取引先＞納入先**・承認ゲート・スナップショット凍結・楽観ロック（統合の核） | 店舗フラット（系列はフェーズ1で後付け） |
| 実行形態 | Cloud Run 1コンテナ（Next.js standalone） | フロント＋FastAPIの2デプロイ |
| 請求・税 | tax.md準拠（GENERATED列・Decimal.js・欠番なし採番） | 簡易 |
| セキュリティ | RLS・requireAdmin・security.mdルール | proxy.tsのみ |
| テスト/規約 | vitest・lint・.claude/rules 体系 | 部分的 |

既存ルール（features.md冒頭）「**独立した Python/FastAPI バックエンドは作らない**」とも一致する。
v4のPythonバックエンドを「PDFマイクロサービス」として残す案は、2ランタイム・2デプロイの
乖離リスク（今回の事故の再演）になるため**採用しない**。

### 2-2. 移行方式はストラングラー（絞め殺し）方式

一括切替はしない。**機能単位で本アプリに移植 → 並行運用で検証 → 切替 → v4を段階的に縮退**。
各ステップでv4に即時ロールバック可能な状態を維持する（v4のCloud Runは§8完了まで停止しない）。

---

## 3. v4機能インベントリと移植先対応表

| v4の機能 | 実装 | 統合後の居場所 | 方針 |
|---|---|---|---|
| ヨークメール取り込み（IMAP） | `email_fetch.py` | 既存 `/api/cron/poll-email` | 実運用チューニング済みプロンプト・ルールを移植（§7） |
| Gemini解析（店舗×品目×規格×入数） | `ocr_parser.py` | 既存 `lib/gemini/` | 「×数字=合計個数」「胡瓜バラ」等の確定ルールをプロンプト＋テストで固定 |
| OCR検証・承認 | verifications画面 | 既存 `/admin/inbox`・`/admin/ocr` | 機能重複。本アプリ側を正とする |
| **出荷ラベルPDF**（8分割・cut-and-stack・端数強調） | `pdf_generator.py` | 新 `lib/pdf/ShippingLabelsPdf.tsx` | @react-pdf/rendererへ移植（§5） |
| **出荷表カード**（紙様式・1明細1ページ） | `generate_shipping_form_pdf` | 新 `lib/pdf/ShippingSheetPdf.tsx` | 同上。供給先=「取引先＞納入先」表記 |
| **出荷一覧表**（店舗×品目・コンテナ集計） | `_draw_summary_page` | 新 `lib/pdf/ShippingSummaryPdf.tsx` | 同上 |
| 品目別出荷票の集計（remainder繰り上げ） | `shipping_sheet.py` | 新 `lib/calculations/aggregate-shipping.ts` | ロジック移植＋v4のテストケースを写経 |
| 印刷キュー＋常駐印刷エージェント | `print_jobs`+`print_agent.py` | `print_jobs` テーブルを本DBに新設 | print_agent.py は**そのまま流用**し接続先だけ変更（§8） |
| Discord自動化（取得→承認→印刷） | `chat_automation.py` | 既存設計 `lib/notify/`＋新規コマンド処理 | 最終ステップで移植（2E） |
| マスタ（店舗・品目・規格・入数） | master画面 | 既存 customers / delivery_destinations / products / pack_configs | データ移行（§6） |
| 納品書・請求書・分析 | invoices/analytics | 既存 `/admin/invoices` ほか | 機能重複。本アプリ側を正とする |

**帳票3種（太字）が現場価値の中核**であり、最初に移植する（ステップ2A）。

---

## 4. UI設計: シンプルと詳細の同居

### 4-1. 原則
1. **現場（/field）に新しい画面を「増やさない」ことがデフォルト**。追加するのは
   「印刷」1ページのみ。既存の注文票的ビュー（/field/shipments 等）は変更しない。
2. 詳細機能は admin サーフェスに置き、現場に見せるかどうかは
   **既存の `lib/field/features.ts`（設定→現場機能の解放）を拡張**して制御する。
   新しいフラグ機構は発明しない。
3. ナビは既存の `FieldBottomBar`＋ハンバーガー、admin は `ADMIN_GROUPS` に従う。

### 4-2. 具体変更
```
lib/settings-spec.ts  STAFF_FEATURE_KEYS に追加:
  printDocs: 'staff_feature_print_docs'   // 現場から帳票印刷を許可

app/field/print/page.tsx（新・現場向け印刷。トグルONのときのみ表示）
  [日付選択: 今日/明日/カレンダー]
  [出荷表を印刷]  [ラベルを印刷]  [出荷一覧表を印刷]   ← 大ボタン3つだけ。48pxターゲット
  ※品目フィルタは「詳細ボタン」を押したときだけ展開（初期状態は全品目）

app/(dashboard)/admin/shipping-docs/page.tsx（新・admin向け帳票センター）
  日付×品目×取引先フィルタ、cut-and-stack逆順トグル、再印刷履歴（print_jobs）
```

### 4-3. 供給先表記（フェーズ1の継承）
帳票・画面の供給先は必ず `lib/format/destination.ts`（新設）で解決する:
```ts
// 「取引先＞納入先」ルールの帳票向け表記。UIのバッジ表示（＞区切り）とは別に、
// 紙では「ヨーク 東道野辺」のようにスペース区切り・納入先なしなら取引先のみ。
export function formatSupplyDestination(customerName: string, destinationName?: string | null): string
```
v4 `destination.py` と同一の意味論（系列＋店舗／系列のみ／互換）。単体テストをv4から写経して固定する。

---

## 5. 帳票移植（ステップ2Aの中身）

### 5-1. 技術選定
- **@react-pdf/renderer**（stack.md既定・InvoicePdf/DeliveryNotePdfで実績あり）。新規依存ゼロ。
- フォントは既存 `lib/pdf/fonts.ts`（Noto Sans JP）を流用。v4のIPAexGothicに固執しない
  （字形差は許容。寸法・配置・強調ルールを守ることが現場価値）。

### 5-2. 変更禁止のコア仕様（v4から寸法ごと移植し、テストで固定）
| 仕様 | 出典（v4） |
|---|---|
| ラベル: A4を2列×4段（105×74.25mm）8分割 | `pdf_generator.py` L23-28 |
| **Cut and Stack 再配置**: `slot = i // P, page = i % P, j = page*8 + slot`（裁断後に重ねるだけで店舗順） | 同 L91-134 |
| 端数ラベルのみ強調（太破線枠・中央二重線・「！」透かし・数量超大） 最後の箱=X/Xでも端数でなければ強調しない | 同 L206-214, L579- |
| ラベル4象限: 左上=供給先(最大50pt自動縮小)/右上=通し番号/左下=品目/右下=入数 | 同 L516- |
| 出荷表カード: 供給先/品目/量目/数量(ケース・端数・点線・合計)/出荷日/生産者名(空欄=手書き) | 同 `generate_shipping_form_pdf` |
| 集計: (store,item,spec,unit)合算、remainder≥unitで箱繰り上げ | `shipping_sheet.py` |
| total_boxes = boxes + (remainder>0 ? 1 : 0)、端数箱 quantity=remainder | `ocr_parser.py` L356-422 |

### 5-3. 検証（ゴールデンサンプル方式）
1. v4本番と同一入力（例: 2026-07-05のヨーク注文）でv4版・移植版の両PDFを生成し並置確認。
2. 自動テスト: 固定入力→（a）ページ数一致（b）抽出テキストの集合一致（c）cut-and-stack
   再配置順のスナップショット。`npm run test`（vitest）に組み込み恒久化。

---

## 6. データ移行

### 6-1. マスタ（ステップ2B・スクリプト1本）
| v4 | 本アプリ | 備考 |
|---|---|---|
| customers.supplier_name（=ヨーク/寺崎） | customers（取引先） | **シード済み（0017）** |
| customers.name（店舗） | delivery_destinations.full_name | **シード済み（0017）**・aliasesにOCR表記ゆれを追加 |
| products | products | 名寄せしてUPSERT |
| product_standards（規格・unit_size・unit_type） | pack_configs（荷姿=入数換算） | P/C=unit_size |
| units.json（品目×規格×店舗の入数） | customer_product_rules.packs_per_case | 店舗依存入数は納入先ヒントとして保持 |

移行は `migrations/0018_seed_v4_product_masters.sql`（冪等SQL）で実施 **[2B実施済み]**。
当初案のTSスクリプト（dry-run付き）は、v4マスタが小規模・静的で両DBの鍵管理が増えるだけと
判断して採用せず、リポジトリ規約どおり migrations に一本化した。並行運用中にv4側のマスタが
変わった場合は同SQLに行を追記して再適用する（冪等なので安全）。

### 6-2. 履歴データ
**移行しない（凍結参照）**。v4のDB（Supabase hynedtz…）は読み取り専用で当面残し、
過去の注文・請求参照はv4のUIで行う。理由: v4の請求は簡易モデルで、本アプリの
スナップショット凍結型請求に変換すると監査上の二重帳簿リスクがある。切替日以降の
データのみ本アプリが正。切替日は設定 `integration_cutover_date` に記録し画面に明示する。

---

## 7. ヨークメール取り込みの移行（ステップ2C・最重要リスク区間）

1. **プロンプト移植**: v4で実運用チューニング済みの解析ルール（×数字=合計個数、
   胡瓜バラ50→100本規格変換、店舗名ゆれ）を `lib/gemini/prompts.ts` に移植。
   確定ルールはプロンプト文でなく**後処理＋単体テスト**で保証する（プロンプト改変に強くする）。
2. **名寄せ**: 店舗名→delivery_destinations.aliases、品目→products.aliases（既存機構）。
3. **影実行（シャドーラン）**: 切替前の5営業日、同じメールを両システムで解析。
   本アプリ側は承認せず `order_receipts.status='pending_review'` で止め、
   v4の確定結果と自動突合した差分レポートを毎朝Discordに送る。
   **差分ゼロが3営業日連続**で現場切替を判定する（判定者=管理者）。
4. **二重取り込み防止**: 切替日前は本アプリ側で自動承認しない。切替日以降はv4の
   メール取得cronを停止（Discord自動化含む）。

---

## 8. 印刷キューと印刷エージェント（ステップ2D）

- `print_jobs` テーブルを本DBに新設（v4と同スキーマ+RLS。migrations連番）。
- v4の `print_agent.py`（事務所PC常駐・Supabaseポーリング→自動印刷）は**改修せず**、
  接続先環境変数のみ本DBに切替。切替週は旧agentも併走させ、どちらでも印刷できる状態で移行。

---

## 9. 実行計画（ステップとロールバック）

| ステップ | 内容 | 完了条件 | ロールバック |
|---|---|---|---|
| **2A 帳票移植** | ラベル/出荷表/一覧表PDF＋/field/print＋formatSupplyDestination | ゴールデンサンプル一致・現場が試し刷りOK | 何もしない（v4継続） |
| **2B マスタ移行** | products/pack_configs移行スクリプト＋寺崎の手動受注開始 | 寺崎1週間運用でLINE手動を置換 | 寺崎のみLINEに戻す |
| **2C メール移植＋影実行** | プロンプト移植・差分レポート | 差分ゼロ3営業日連続 | 本アプリ側cron停止のみ |
| **2D 現場切替** | 取り込み・印刷を本アプリに一本化、v4読み取り専用化、print_jobs切替 | 1週間の安定稼働 | v4 cron再開（手順書を事前作成） |
| **2E 自動化移植・退役** | Discord自動化移植→v4 Cloud Run停止・DBエクスポート保管 | — | （2Dに戻る） |

各ステップは独立したPRとし、`npm run test`／`typecheck`／`lint`＋帳票スナップショットをゲートにする。

## 10. リスクと対策

| リスク | 対策 |
|---|---|
| 解析精度がv4より落ちて現場が混乱 | §7 影実行＋差分ゼロ3日ゲート。切替後も1週間はv4を即再開可能に保つ |
| 帳票の見た目差で現場が戸惑う | §5 ゴールデンサンプル並置確認を現場担当者と行う（数値・強調ルールは完全一致、字形のみ差） |
| 二重取り込み・二重印刷 | 切替日設定の一元管理＋cron ON/OFFはデプロイでなく設定で切替 |
| v4退役後に過去データが必要になる | v4 DBは読み取り専用で1年保持＋エクスポート（CSV/SQL）をR2に保管 |
| 印刷エージェント切替失敗 | 旧新併走期間を設ける。agentは無改修（接続先のみ変更） |
| 「シンプルさ」が統合で失われる | §4 原則1（fieldに増やすのは印刷1ページのみ）をレビュー基準に明文化 |
