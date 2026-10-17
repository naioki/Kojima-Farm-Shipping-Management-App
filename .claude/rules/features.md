---
paths:
  - "app/**"
  - "components/**"
  - "lib/**"
  - "migrations/**"
---

# 受注・現場・B2Bポータル 実装仕様書（features.md）

> このファイルは `.claude/rules/` に配置する。`CLAUDE.md` / `design.md` / `tax.md` / `security.md` /
> `stack.md` / `structure.md` の既存ルールに **従属** する。衝突した場合は既存ルールが優先。
> アーキテクチャは **Cloud Run 一体型（Next.js Route Handlers）** で確定。
> 独立した Python/FastAPI バックエンドは作らない。OCR・差分・PDF はすべて Route Handlers 内で処理する。

---

## 0. このシステムの全体像（4チャネル → 検証 → 圃場）

```
受注チャネル                     検証（admin）            圃場（staff・タブレット）
─────────────────────────────────────────────────────────────────────
FAX   → Drive → R2原本 ─┐
メール（IMAP/独自ドメイン）├→ Gemini解析 → pending_review → 承認 → harvest_tasks 生成
B2Bポータル（Magic Link）─┤   （構造化済みなのでOCR不要）              ↓
手動入力（admin画面）    ─┘                                  マトリックスタイムライン
                                                            （タップループ／部分完了／オフライン）
                                                                      ↓
                                                            出荷確定 → invoices（月末集計）
```

設計思想：**OCRが必要なのは FAX とメール画像だけ**。B2Bポータルと手動入力は最初から構造化データなので
Gemini を通さない。これが Gemini 無料枠の枯渇対策の核心であり、ポータル普及がコストを下げる。

---

## 1. 既存10テーブルへの統合方針（並列スキーマを作らない）

この会話で設計した独自テーブルは、既存テーブルに **吸収** する。新規は最小限。

| 設計した概念 | 既存テーブルへの統合先 | 対応 |
|---|---|---|
| raw_receipts（全受信ログ） | **新規 `order_receipts`** | orders とは別に「受信の生ログ・重複判定」を持つ |
| order_item_history（変更履歴） | **既存 `audit_log`** を使う | 新規作成しない。Undoもこの上に構築 |
| packaging_specs（荷姿） | **新規 `customer_product_rules`** | 取引先×商品のP/C・荷姿・端数ポリシー |
| inventory（収穫見込み） | **既存 `harvest_tasks` + 新規 `harvest_estimates`** | tasks=必要数、estimates=見込み数 |
| customer_contacts（連絡先） | **既存 `customers` を拡張** | チャネル別識別子を JSONB で保持 |
| unmatched_receipts | `order_receipts.status='unmatched'` | テーブルを増やさずステータスで管理 |
| gemini_usage_log | **新規 `gemini_usage_log`** | 無料枠管理に必要 |

### 新規追加テーブル（4つだけ）

```sql
-- ① 受信ログ（チャネル横断・重複/再送判定の中核）
CREATE TABLE order_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT NOT NULL CHECK (channel IN ('fax','email','portal','manual')),
  customer_id     UUID REFERENCES customers(id),          -- 未紐付けは NULL
  order_id        UUID REFERENCES orders(id),             -- 解析後に紐付け
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_date   DATE,                                   -- 出荷予定日（承認時に必須確定）
  sender_date_key TEXT,                                   -- "識別子_YYYYMMDD"（再送判定キー）
  exact_hash      TEXT,                                   -- FAX/画像のMD5（完全重複検知）
  message_id      TEXT,                                   -- メールの Message-ID（処理済み判定）
  r2_key          TEXT,                                   -- 原本（FAX画像/メール添付）の R2 キー
  raw_payload     JSONB,                                  -- テキスト本文・ポータル送信内容など
  is_revision     BOOLEAN DEFAULT FALSE,                  -- 再送（追加）受信か
  parent_id       UUID REFERENCES order_receipts(id),
  ocr_confidence  NUMERIC,
  status          TEXT NOT NULL DEFAULT 'pending_ai'
    CHECK (status IN ('pending_ai','ai_failed','pending_review','approved','duplicate','unmatched')),
  retry_count     INTEGER DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX uq_receipt_exact ON order_receipts(exact_hash) WHERE exact_hash IS NOT NULL;
CREATE UNIQUE INDEX uq_receipt_msgid ON order_receipts(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_receipt_senderkey ON order_receipts(sender_date_key);

-- ② 取引先×商品の取引ルール（荷姿・P/C・端数ポリシー・定番セット）
CREATE TABLE customer_product_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES customers(id),
  product_id         UUID NOT NULL REFERENCES products(id),
  packs_per_case     NUMERIC,                  -- P/C（スマートパース・OCR検証の基準値）
  container_type     TEXT,                     -- "ケース"/"箱"/"化粧箱"
  label_spec         TEXT,                     -- "Oisixラベル"/"農園独自" 等
  tape_color         TEXT,                     -- "透明"/"黄"/"赤"
  packing_notes      TEXT,
  fraction_policy    TEXT DEFAULT 'confirm'
    CHECK (fraction_policy IN ('carry_over','loose','round_down','confirm')),
  is_default_set     BOOLEAN DEFAULT FALSE,    -- 「いつものセット」に含むか
  default_quantity   NUMERIC,                  -- 定番セットの既定数量
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, product_id)
);

-- ③ 収穫見込み（日付×商品。harvest_tasks=必要数 と分離）
CREATE TABLE harvest_estimates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  estimate_date   DATE NOT NULL,
  planned_qty     NUMERIC,                     -- 事前計画（複数日一括入力）
  estimate_qty    NUMERIC,                     -- 当日朝の見直し
  actual_qty      NUMERIC,                     -- 実収穫（後から確定）
  carry_over      NUMERIC DEFAULT 0,           -- 前日繰越
  adjustment_memo TEXT,                        -- 「第3ハウス不調」等
  status          TEXT NOT NULL DEFAULT 'not_entered'
    CHECK (status IN ('not_entered','planned','estimated','confirmed')),
  created_by      UUID REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_id, estimate_date)
);

-- ④ Gemini 使用量（無料枠管理）
CREATE TABLE gemini_usage_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  called_at   TIMESTAMPTZ DEFAULT now(),
  mode        TEXT,        -- 'normal'/'diff'
  channel     TEXT,
  tokens_used INTEGER,
  success     BOOLEAN
);
```

### 既存テーブルへの追加カラム

```sql
-- orders：出荷日と再送・楽観ロック
ALTER TABLE orders ADD COLUMN delivery_date_source TEXT
  CHECK (delivery_date_source IN ('parsed','manual','assumed_next_day'));
ALTER TABLE orders ADD COLUMN confirmed_no_order BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN shipping_time TEXT CHECK (shipping_time IN ('am','pm'));

-- order_items：楽観ロック・荷姿・出荷実績・端数メモ・確信度
ALTER TABLE order_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_items ADD COLUMN rule_id UUID REFERENCES customer_product_rules(id);
ALTER TABLE order_items ADD COLUMN confidence NUMERIC;
ALTER TABLE order_items ADD COLUMN is_flagged BOOLEAN DEFAULT FALSE;  -- confidence<0.7
ALTER TABLE order_items ADD COLUMN shipped_qty NUMERIC;               -- 実出荷数（部分完了）
ALTER TABLE order_items ADD COLUMN shipped_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN field_status TEXT DEFAULT 'not_started'
  CHECK (field_status IN ('not_started','packed','shipped'));         -- タップループ用
ALTER TABLE order_items ADD COLUMN fraction_note TEXT;

-- customers：チャネル別識別子（FAX番号/メール/ポータルユーザー/LINE WORKS ID）
ALTER TABLE customers ADD COLUMN channel_identifiers JSONB DEFAULT '{}'::jsonb;
-- 例: {"fax":["0479xxxxxxx"], "email":["order@x.co.jp"], "portal_user_id":"uuid"}
```

> **注意**：税率・金額・請求は既存 `tax.md` のルールが絶対。`order_items.tax_rate` 冗長保持、
> `subtotal/tax_amount/line_total` は GENERATED 列、Decimal.js、請求書番号欠番なし——一切変更しない。

---

## 2. 受注チャネル別 実装

### 2-1. FAX（既存FAX受信 → Drive → 取り込み）

既存の自作FAX受信（FastAPI）は **そのまま流用**。Drive にPDF/画像が落ちる。
取り込みは Cloud Run 上の Next.js Route Handler を **Cloud Scheduler が5分毎に叩く**。

```
GET /api/cron/poll-drive  （Cloud Scheduler → OIDC認証付き）
  1. Drive API: 指定フォルダの createdTime > lastPoll のファイル取得
  2. 原本を Cloudflare R2 に保存（7年保存、tax.md準拠）
  3. exact_hash 計算 → order_receipts に INSERT（重複は uq制約で弾く）
  4. ファイル名から sender_date_key 抽出（失敗時は status='unmatched'）
  5. 重複・再送判定（§3）→ Gemini 解析（§4）
```

ファイル名規則は **config で管理**（コード直書き禁止）。規則変更時にコードを触らない。

### 2-2. メール（独自ドメイン・IMAP）

```
GET /api/cron/poll-email  （5分毎）
  - IMAP接続 → 専用アドレス（order@kojima-farm.jp 推奨）INBOX
  - 重複判定は Message-ID のみで行う（既読フラグに依存しない＝誤スキップ防止）
  - 本文 text/plain 優先、HTMLはテキスト化。添付画像/PDFは R2保存＋画像解析へ
  - 件名/本文に注文語（注文・発注・ご注文）を含むものを優先。それ以外は status='unmatched'
  - 処理後 Gmail/IMAP 側に "processed" ラベル付与（ダブルチェック）
```

### 2-3. B2Bポータル（Magic Link）★ 新規・最推奨

**結論：Magic Link を採用する。** パスワード管理を取引先に強いない＝定着しやすく、
最大の利点は **OCRを完全に回避できる**こと。構造化入力なので Gemini もスマートパースも不要。

実装：
```
- 認証：Supabase Auth の Magic Link（メールにリンク送信、パスワードレス）
        取引先担当者のメール = customers.channel_identifiers.email と照合
- 画面：/portal/login → /portal/order
        ・「いつものセット」を customer_product_rules(is_default_set=true) から自動表示
        ・数量だけ調整 → 送信（1分で発注完了）
        ・出荷希望日（delivery_date）を必須選択
- 取り込み：source='portal' で orders を直接 INSERT、status='pending_review'
        ・OCR confidence は常に 1.0（人間入力扱い）
- RLS（最重要）：取引先は自分の customer_id の注文しか見られない
        CREATE POLICY portal_own ON orders FOR SELECT
          USING (customer_id = (auth.jwt()->'app_metadata'->>'customer_id')::uuid);
```

ポータルは admin/staff とは **別レイアウト・別ルート (`/portal`)**。RLSを必ずテストする。

### 2-4. 手動入力（admin バックオフィス）

```
/admin/orders/new
  - 取引先プルダウン（インクリメンタルサーチ）→ 選ぶと「いつものセット」自動展開
  - 数量は ui_ux_requirements の混在記号をそのまま受付（§5 スマートパース）
  - テキスト貼り付け（個人LINE等の転記）も可 → Gemini テキスト解析を任意で通せる
```

---

## 3. 重複・再送判定（「同じFAXに追加して丸ごと再送」対応）

取引先の慣習：前回FAXに行を足して **丸ごと再送** してくる。差分だけ取り込む。

```
判定ロジック（order_receipts 受信時）:
  1. exact_hash 一致         → 完全重複。status='duplicate'、解析せず終了
  2. sender_date_key 一致    → 同日・同送信元の再送。is_revision=true、§4 を差分モードで
     （channel別 sender_date_key:
        fax    = FAX番号_YYYYMMDD
        email  = 送信元アドレス_YYYYMMDD
        portal/manual = 再送概念なし。ただし同日同顧客は警告表示）
  3. いずれも無し            → 新規注文
```

差分の反映は **既存注文への加算/更新** とし、変更は必ず `audit_log` に記録（§6 Undoの基盤）。

---

## 4. Gemini 解析（通常／差分・無料枠管理）

```
モデル: gemini-2.0-flash（無料枠 ~1500req/日）
前処理: グレースケール＋コントラスト強調＋1200x1600へ縮小（トークン節約）

通常モード: 画像/テキスト → items[]（raw_name, product_name, quantity, unit, confidence）
差分モード: 前回確定 items[] をプロンプトに注入 → added/modified/removed を返す

確信度: 全項目に self-confidence を 0..1 で自己採点させる。<0.7 は is_flagged=true → UI赤
名寄せ: products.aliases と SequenceMatcher 照合。一致<0.7 は要確認フラグ
```

### 無料枠の優先度キュー（5チャネルで枯渇させない）

```
P1 即時：ポータル/手動（そもそもGemini不要）
P2 5分 ：FAX・メール画像（OCR必要）
P3 バッチ：差分の低確信度再解析・週次レポート

残200req → P3停止 ／ 残50req → P2停止しLINE WORKS警告 ／ 残0 → 自動解析停止・手動受付のみ
（gemini_usage_log を毎呼び出し記録。日次/分次カウントで判定）
```

---

## 5. スマートパース（最重要のビジネスルール）

`lib/calculations/parse-quantity.ts` に集約。**Decimal.js 使用、浮動小数点禁止（tax.md準拠）。**

```
入力例と解釈（customer_product_rules.packs_per_case = P/C を基準に換算）:
  "15c2"  → 15ケース + 端数2パック   = 15*P/C + 2
  "10"    → 10（単位はその商品の既定）
  "x" 記法 → 「x の後の数字は箱数ではなく "合計個数"」★絶対ルール（CLAUDE.md / メモリ）
  空欄保存 → その日の出荷レコードを削除（マトリックス入力の仕様）

総数 ÷ container_capacity = コンテナ数 … 端数（§現場ダッシュボードで「総数/ケース/端数」表示）
```

この関数は **単体テスト必須**（誤解釈が出荷ミス・請求ミスに直結するため）。

---

## 6. 数量変更とUndo（audit_log の上に構築・新テーブル不要）

```
変更 POST /api/order-items/[id]
  1. 楽観ロック：WHERE id=$ AND version=$expected。更新0件＝競合 → 409でUI再読込促す
  2. 旧値→新値を audit_log に INSERT（old_values/new_values/changed_fields）
  3. version++、orders.updated_at 更新、Realtime通知

Undo POST /api/order-items/[id]/undo
  - audit_log の最新変更を逆適用。Undo自体も audit_log に action='undo' で記録
  - Undo可能期限：承認後変更=24h、出荷後訂正=72h（audit_log.created_at で判定）
  - Undo不可条件：shipped_at 記録済み／請求書 finalized 済み／期限切れ／他者が編集ロック中
  - Redo は実装しない（複雑化回避）
```

UIは変更後カードに「50→58 [↩元に戻す（残21h）]」を表示。期限切れ・出荷済みはボタン非表示。

---

## 7. 圃場UI（タブレット）— タップループは「採用、ただし安全化」

**結論：タップループは採用する。** 手袋・泥・直射日光下で最速。ただし提示された
`白→緑✓→グレー🚚→白` の **4タップ目で白に戻る循環は危険**（誤タップで出荷済みが消える）。

### 採用する安全版タップループ

```
前進のみ循環させない：
  白(未着手) → タップ → 緑✓(梱包完了) → タップ → グレー🚚(出荷済)
  ↑ ここで止まる。リセットは別ジェスチャ（長押し → 確認ダイアログ）に分離
  → field_status: not_started → packed → shipped（後退は長押しＵndoのみ）

部分完了：セルの ⌨️ をタップ → 大型テンキー → shipped_qty 入力 → 黄色表示
オフライン：圏外でもタップ可（IndexedDB outbox に積む）→ 復帰時に自動同期
リアルタイム：admin が数量変更 → 該当セル赤点滅 + 差分(+10) → ワーカーがタップ確認で通常へ（音なし）
```

### マトリックスタイムライン

```
行 = 取引先×商品 ／ 列 = 日付（§日付コントロール: 今日/明日/3日/7日/カスタム）
セル = スマートパース表示（"15c2" → 内部は総数、表示は総数/ケース/端数）
品目タブで横スクロール回避（ui_ux_requirements 準拠）
タップターゲット 48px 厳守（design.md）。数字は font-mono tabular-nums
```

### オフライン同期（現実的スコープ）

```
PWA + Service Worker。アプリ全体のオフライン化は狙わず「タップ操作のキューイング」に限定:
  - 各タップ/部分数量を IndexedDB の outbox に {item_id, field_status, version, ts} で記録
  - 楽観的にUI即時反映 → オンライン復帰で順次 PATCH 送信
  - サーバ側で version 不一致なら競合 → そのセルだけ赤表示で手動確認（§6の楽観ロック流用）
```

---

## 8. 現場ダッシュボード（日付・期間／コンテナ・端数／不足アラート）

```
日付コントロール: [今日][明日][3日][7日][カスタム] ＋ 前後送り
単日 = 「今日やること」優先順（不足品目を最上位に自動ソート）
複数日 = 品目×日付グリッド＋累計過不足行（今日余裕でも3日後に詰まるを事前検知）
7日 = recharts 棒グラフ（注文 vs 収穫見込み。注文未確定日はグレーアウト＋確定日数明示）

数量表示 = 総数／コンテナ数／端数（products.container_capacity で自動分解）
過不足 = 収穫見込み(harvest_estimates) − 必要数(harvest_tasks 集計)
  不足→alert色＋数値強調、余剰→harvest色
未入力対策 = harvest_estimates.status='not_entered' は「0」でなく「⚠️未入力」表示
複数日一括入力フォーム＋「前週同曜日コピー」
```

---

## 9. 出荷作業指示書（荷姿の自動展開）

承認済み注文 → 取引先別の梱包指示を自動生成（customer_product_rules を展開）。

```
🍅 トマト 58個
 ① マルショク：5kg化粧箱×1(20個)+バラ10個／Oisixラベル／黄テープ
 ② サンデー  ：標準10kg箱×1(20個)／農園独自ラベル／透明テープ
 ③ Wagoen組合：組合指定箱（端数=要確認）／組合ラベル ⚠️
午前出荷:①② ／ 午後出荷:③
```

`shipping_instructions` 相当は当面 **ビュー/オンザフライ生成** で十分（テーブル化は後続）。
「組合指定」「仲介A店舗経由」など農園が制御できない荷姿は **自動確定せず必ず人間確認**。

---

## 9-2. Discord連携（LINE WORKSと並列の通知先）

LINE WORKSと**同じ通知を並列送信**する。通知ロジックを1か所に集約し、送信先を増やすだけにする。

```
lib/notify/index.ts
  notify(event, payload) を呼ぶと LINE WORKS と Discord の両方に送る
  片方が失敗しても他方は送信する（Promise.allSettled）

通知イベント（既存LINE WORKS通知に揃える）:
  - 承認待ち発生（新規/差分受信）
  - AI確信度低（要確認フラグ）
  - Gemini無料枠 残50/0 警告
  - 取引先未紐付け受信
  - 楽観ロック競合（同時編集）
  - 翌日以降の不足予測（前日17時バッチ）

実装:
  - Discord Webhook URL を Secret Manager に保存（環境変数直書き禁止、security.md準拠）
  - lib/notify/discord.ts: fetch で Incoming Webhook に POST（embed形式、色分け：
      赤=alert系, 黄=要確認, 緑=情報)
  - lib/notify/line-works.ts: 既存実装をこのインターフェースに合わせてラップ
  - 通知先のON/OFFは環境変数で切替可能にする（開発時はDiscordのみ等）
```

将来、開発チーム向けの別チャンネル（デプロイ結果・エラー）が必要になった場合は
`notify()` とは別の `lib/notify/dev-channel.ts` を追加する（用途混在を避ける）。

---

## 10. 失敗しやすい問題と対策（実装前に潰す）

| # | 問題 | 対策（このファイル内の対応箇所） |
|---|------|------|
| 1 | Gemini無料枠が5チャネルで枯渇 | §4 優先度キュー。ポータル普及でOCR自体を減らす |
| 2 | メール既読フラグ依存で取り込み漏れ | §2-2 Message-ID判定に限定 |
| 3 | ポータル/Webhook無防備 | §2-3 RLS必須。Webhook使うなら署名検証 |
| 4 | 圃場Wi-Fi切断でダッシュボード硬直 | §7 オフラインoutbox＋復帰同期。接続インジケーター常時表示 |
| 5 | 同時編集の上書き | §6 楽観ロック version。競合は409で再読込 |
| 6 | 新規取引先が未紐付けでDB書けない | order_receipts.status='unmatched'＋手動紐付けUI |
| 7 | delivery_date不明で期間表示が崩れる | orders.delivery_date 承認時必須。source記録 |
| 8 | タップループ誤操作で出荷済みが消える | §7 4タップ目循環を廃止、リセットは長押し＋確認 |
| 9 | スマートパース誤解釈で請求ミス | §5 単体テスト必須。"x"=合計個数の絶対ルール |
| 10 | システム全断で現場停止 | 週1で「定番注文リストPDF」をLINE WORKS配信→紙運用に切戻し可 |
| 11 | 通知先が1つで見落とされる | §9-2 LINE WORKS＋Discord並列送信。片方失敗で全体停止しない |

---

## 11. フェーズ計画（既存 design.md のPhase 1完了後に接続）

```
Phase A: migrations（新規4テーブル＋既存カラム追加＋RLS）／スマートパース＋単体テスト
Phase B: 取り込みcron（Drive/IMAP）＋Gemini解析（通常/差分）＋無料枠管理
Phase C: admin 検証画面（差分ハイライト・確信度・承認・Undo）
Phase D: 圃場マトリックス（タップループ安全版・部分完了・日付期間・不足アラート）
Phase E: B2Bポータル（Magic Link・いつものセット・RLS）
Phase F: オフライン同期（PWA/IndexedDB outbox）＋Realtime赤点滅
Phase G: 出荷指示書生成 → 既存の請求書(invoices)フローに接続
```
