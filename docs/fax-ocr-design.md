# FAX読み取り 設計書 — 確実で最適なOCRパイプライン

> 対象：小島農園 受注管理アプリの FAX/画像 → 構造化注文データ変換。
> 上位ルール：`.claude/rules/features.md`（§0,§3,§4,§5）に従属。衝突時は features.md 優先。
> 目的：**受発注ミス＝農園の信用毀損**を最小化しつつ、人手とAIコストを最適化する。

---

## 0. 結論（先に要点）

FAX読み取りで「確実」を担保する鍵は **OCRの賢さではなく、誤りを前提にした多層防御**である。
単一のGemini呼び出しの精度を上げる努力より、以下の積み重ねが事故率を桁で下げる。

1. **入力の正規化**（前処理）でAIに渡す前に読みやすくする ← 最も費用対効果が高い
2. **構造化出力**を `orders[]` に統一（マトリックスFAXを失わない）
3. **AI自己採点 confidence を信用しすぎない** — 外部検証（名寄せ・数量整合・履歴比較）で裏取り
4. **自動承認は全条件AND**でしか発火させない（features.md auto-approve.ts の思想）
5. **人間確認UIが最後の砦** — 速く・赤で危険を示し・1注文単位で承認
6. **学習ループ**で取引先ごとの癖を貯め、確信度を時間とともに上げる
7. **全件を証跡（R2原本＋order_receipts）に残す** — 後から監査・再解析できる

### 構造的問題の対応状況

**第1次実装（完了）** — 自動パイプラインの骨格を配線した。

| # | 問題 | 状態 | 実装 |
|---|------|------|------|
| G1 | 自動取り込みの解析が未配線 | ✅実装 | `lib/ingestion/process-receipt.ts` ＋ poll-drive/poll-email に配線 |
| G2 | プロンプト2系統分岐 | ✅実装 | `analyzeOrders(orders[])` に統一・hintText 注入 |
| G3 | 画像前処理が自動側に無い | ⚠️一部 | `lib/ocr/preprocess.ts`（grayscale/normalize/resize/jpeg＋180°）。deskew/二値化は未 |
| G4 | quotaゲート未実装 | ✅実装 | `lib/gemini/quota.ts: canRunGeminiNow()` |
| G5 | 多ページ・回転・歪み | ⚠️一部 | 180°リトライのみ。PDF多ページ・deskew は未（§3） |

**残課題（第2次・要対応）** — 第1次実装中に判明した本質的な穴。自動承認をONにする前に潰す。

| # | 問題 | 影響 | 決定 |
|---|------|------|------|
| G6 | 自動承認INSERTが存在しないカラムに依存 | `orders.receipt_id`/`orders.is_revision`/`order_items.quantity_raw` が無くINSERT失敗→全件pending_reviewに黙って落ちる | §7-2：連携は`order_receipts.order_id`で行い、`quantity_raw`はマイグレーション追加 |
| G7 | スマートパース未配線 | `quantity:0` で保存。`parse-quantity.ts` を呼んでいない | §5-2：保存時に`parseQuantity`→総数。解釈不能は人手 |
| G8 | 再送（revision）の二重計上 | revisionでも新規orderを作り、既存注文に加算しない（features.md §3違反） | §7-3：revisionは自動承認せず必ず差分レビューへ |
| G9 | PDFを sharp が読めない | 前処理が例外→生バイトfallback。多ページ非対応 | §3-3：当面 Gemini ネイティブPDF。精度不足なら pdf→画像化 |
| G10 | ai_failed の再試行ループが無い | 一度失敗したら放置 | §9-2：cron が`next_retry_at`到来分を再投入（最大3回） |

---

## 1. 入力の現実 — FAXは「汚い・多様・順不同」

小島農園に届くFAXの分類（実サンプルより）。設計はこの多様性を**最初の判定**で仕分ける。

| 型 | 例 | 構造 | 出力 |
|----|----|------|------|
| 単純型 | 1枚=1注文（宛名+明細行） | customer 1 × date 1 | orders 要素1 |
| 複数日付型 | 1枚に「月火水…」の納品日列 | customer 1 × date N | date ごとに order 分割 |
| マトリックス型 | 和郷園 週間表（日付×商品×行先） | date M × customer N | 組み合わせごとに order 分割 |
| 非受注 | 仕向け別出荷数量表・集計・請求書 | — | `is_order:false`, 除外 |

### 画質・記載の劣化要因（confidenceを下げるべき信号）

- 手書きのかすれ・濃淡ムラ、FAX送信ノイズ（白点・横線・潰れ）
- 数字の誤読ペア：**0/6・1/7・4/9・5/6・3/8**、手書き「7」と「ノ」
- 訂正跡・二重線・上書き、欄外の手書き追記
- 傾き（スキャナ/FAX由来の±数度）、上下逆さま、複数ページの綴じズレ
- 罫線と文字の重なり（特にマトリックス表）

> 原則（features.md §5）：**「正しく写す」＞「気を利かせて整える」**。
> 読めないものを推測で埋めず、空にして confidence を下げる。

---

## 2. パイプライン全体像（自動 / 手動の二経路を1つの中核に集約）

```
                          ┌─────────────────────────────────────────┐
[自動] FAX→Drive→cron ───►│  正規化  ─►  Gemini   ─►  検証      ─►  判定 │
[自動] メール→IMAP ───────►│ (§3前処理)  (§4 orders[]) (§5名寄せ/数量) (§6/§7)│
[手動] admin OCR画面 ─────►│                                          │
                          └────────────────┬────────────────────────┘
                                           ▼
              order_receipts(証跡) ─► auto-approve判定(§7)
                                           ├─ 全条件OK → orders 自動INSERT(approved)
                                           └─ 不足あり → pending_review → 人間確認UI(§6)
                                                                            │
                                                              修正 → learning(§7) に蓄積
```

**設計判断：自動と手動は「入口」だけ違い、§3以降の中核ロジックは共有する。**
現状は手動だけ新ロジック（`analyzeOrders`）で先行実装済み。自動側（poll-drive）を同じ中核に接続するのがG1/G2の解消。

### 中核ステージ（共有モジュール）

| ステージ | 責務 | 実装（既存/新規） |
|---------|------|------------------|
| Normalize | 画像を読みやすく整える | **新規** `lib/ocr/preprocess.ts`（§3） |
| Extract | Gemini で `orders[]` 抽出 | `lib/gemini/analyze.ts: analyzeOrders`（実装済・自動へ展開） |
| Resolve names | raw_name → product 名寄せ | `lib/matching/name-match.ts`（実装済） |
| Parse qty | "15c2" 等の数量解釈 | `lib/calculations/parse-quantity.ts`（実装済） |
| Validate | 数量の異常検知・履歴比較 | `app/api/orders` の90日比較（実装済・前段へ流用） |
| Dedupe | 完全重複/再送判定 | `lib/receipts/dedupe.ts`（実装済） |
| Decide | 自動承認 or 人手 | `lib/ingestion/auto-approve.ts`（実装済） |
| Learn | 修正を取引先ごとに蓄積 | `lib/ingestion/learning.ts`（実装済） |

---

## 3. 画像前処理（最大の精度レバー・新規 `lib/ocr/preprocess.ts`）

OCR精度はモデルより**入力品質**に強く依存する。Geminiに渡す前に必ず通す。

### 3-1. 現在のパイプライン（実装済 `lib/ocr/preprocess.ts`）

```
入力(画像)
  → 1. EXIF回転自動補正（sharp .rotate()）
  → 2. グレースケール化
  → 3. コントラスト正規化（sharp .normalize()：黒点/白点を両端へ）
  → 4. 長辺 1600px リサイズ（features.md §4：1200×1600目安）
  → 5. JPEG q80 で base64 化（Geminiトークン・転送量を抑制）
```

- **実装エンジン**：Cloud Run(Node)上の `sharp`（ネイティブ高速・依存軽い）。
- 手動側の既存 `lib/image/downscale`（ブラウザ縮小）は入口圧縮として残し、サーバ側で本処理。

### 3-2. 将来追加（精度が頭打ちになったら）

現状は最小構成。以下は**効果と複雑さを見て段階的に**入れる（最初から全部入れない）。

- **自動傾き補正（deskew）**：±15°のハフ変換 or 投影プロファイル。FAXの傾きが誤読要因なら追加。
- **適応的二値化**：マトリックス罫線を残しつつ文字を立てる。ただし**過度な二値化はかすれ文字を消す**ので、
  原画像も必ず保持してGeminiに渡せるようにする（二値化版と原画像版の二刀流）。
- 重度の歪みのみ OpenCV.wasm。

### 3-3. PDF の扱い（G9 の決定）

`sharp` は PDF を直接デコードできない。決定：

- **当面：Gemini ネイティブPDFに委ねる**。`application/pdf` は前処理をスキップし、生バイトをそのまま渡す
  （Geminiは複数ページPDFをネイティブ解釈できる）。`preprocess` は mimeType を見てPDFを素通しする。
- **精度不足が確認されたら**：`pdf-to-image`（pdfium/poppler）でページ→画像化し、各ページに 3-1 を適用して結合。
  巨大PDFはトークンを食うので、その時点で導入する。
- **回転（上下逆さま）**：180°は1回目が `is_order:false`＋低confidenceなら180°回転して再試行（§9）。実装済。

### 3-4. やってはいけないこと

- 数量欄だけ切り抜くような早すぎる領域分割 → レイアウト崩れFAXで列ズレを起こす。
  領域分割はやらず、整った全体画像をGeminiに渡し、構造解釈はLLMに任せる。

---

## 4. 抽出（Gemini）— 構造化出力を `orders[]` に統一

### 4-1. 出力スキーマ（手動・自動で共通化）

```jsonc
{
  "is_order": boolean,              // Step1: 受注書か否か（非受注を除外）
  "orders": [
    {
      "customer_name": string|null, // 発注元/得意先。マトリックスは行ごとの行先
      "delivery_date": string|null, // "YYYY-MM-DD"。年欠落はヘッダ日付から推定
      "items": [
        { "raw_name": string, "product_name": string|null,
          "quantity": string,       // 生表記のまま（"15c2"を計算しない）
          "unit": string|null, "confidence": number }  // 0..1 自己採点
      ]
    }
  ]
}
```

- **`items[]`（旧・自動側）は廃止し `orders[]` に寄せる**（G2解消）。
  理由：マトリックス/複数日付FAXは flat `items[]` だと date/customer 文脈が消え、誤った注文に混ざる。
  `analyzeNormal`/`analyzeDiff` は差分再送（features.md §3）専用に縮退させ、新規解析は `analyzeOrders` に一本化。
- スキーマは `lib/gemini/analyze.ts` の zod と**一対一**を厳守（features.md §1 注記）。

### 4-2. プロンプト設計の要点（`DEFAULT_GEMINI_PROMPT_ORDERS`）

実装済み。設計上の不変条件として固定する：

1. **Step1 受注判定を先頭**に置く（非受注を早期除外しトークン浪費を防ぐ）
2. **quantityは生表記**。`x`の後ろは合計個数だが**計算しない**（CLAUDE.md/メモリの絶対ルール）
3. **行ごと=1 item**（規格違いをまとめない）
4. **confidence を正直に**：誤読ペア・かすれ・訂正跡があれば必ず下げるよう明示
5. 宛名・住所・電話・FAX番号・挨拶・合計・備考は item に含めない
6. **コードフェンス禁止・JSON のみ**（`extractJson` がフェンス除去するが二重防御）

### 4-3. モデルと取得設定

| 項目 | 値 | 根拠 |
|------|----|----|
| モデル | `gemini-2.5-flash`（設定`GEMINI_MODEL`で上書き可） | 無料枠・速度・画像理解のバランス |
| 出力 | `response_mime_type: application/json` を可能なら指定 | パース失敗の低減（将来 responseSchema も） |
| temperature | 0〜0.2（低温） | 創作を抑え「写経」させる |
| キー | Secret Manager → 環境変数 | security.md（直書き禁止） |

### 4-4. 信頼を上げる任意拡張（コスト見合いで）

- **2回読みの一致確認**：重要取引先のみ同一画像を2回解析し、数量が割れた行だけ confidence を強制的に下げて人手へ。コスト2倍なので全件はやらない。
- **few-shot 注入**：`buildCustomerHintText`（learning.ts）で取引先別の表記対応を渡す。実装済の学習を `analyzeOrders` にも配線する。

---

## 5. 抽出後の外部検証（AIの自己採点を信用しない層）

confidence は自己申告であり「正解」ではない（auto-approve.ts のコメント通り）。
**機械的に裏取りできるものは裏取りする。**

### 5-1. 名寄せ（`lib/matching/name-match.ts`・実装済）

- raw_name を products.name + aliases に Levenshtein 類似度で照合、**閾値0.7**未満は `needsConfirmation`。
- 一致しても**取引先別の学習ヒント**（learning.ts）が優先（「この客の桃太郎＝トマト」）。

### 5-2. 数量の整合検証とスマートパース配線（G7の決定）

**決定：保存時に必ず `parseQuantity` を通し、生表記と総数の両方を持つ。**

```
保存（saveOrder / OcrSaveSection）時:
  raw = "15c2" 等の生表記
  pc  = customer_product_rules.packs_per_case（取引先×商品。無ければ null）
  r   = parseQuantity(raw, { packsPerCase: pc })
    r.type==='ok'     → order_items.quantity = r.total（総数。Decimal→NUMERIC）
                         order_items.quantity_raw = raw（生表記を保持・G6マイグレーション）
    r.type==='delete' → その明細を作らない（マトリックスの空欄仕様）
    r.type==='error'  → 総数を確定できない（例：c記法だがP/C未設定）
                         → 自動承認は不可。pending_review で人手に総数を確定させる
```

- 生表記の保持理由（features.md §5）：後から「AIがどう読んだか」を監査でき、学習にも使える。
- **過去90日の同取引先×商品の最大値**と比較（`app/api/orders` 既存ロジックを前段へ流用）。
  2.5倍超は `warning` として**赤フラグ**（保存は止めない＝誤検知で業務を止めない）。
- 自動パイプラインでは `r.type==='ok'` 以外は**全て pending_review**（誤った総数で自動入力しない）。

### 5-3. 日付の妥当性

- `delivery_date` が過去日・1年超先・非営業日なら確信度を落として人手へ。
- 年欠落でヘッダから推定した場合は `delivery_date_source='assumed_*'` を必ず記録（features.md §10-#7）。

---

## 6. 人間確認UI — 最後の砦（`OcrSaveSection` を基盤に）

自動化が進んでも、**危険なものだけ確実に人が見る**導線が事故を防ぐ。
読み取り結果を「眺めるだけ（旧プレビュー）」で終わらせず、**その場で注文として確定（保存）**できることが必須。

### 6-1. 確定（決定ボタン）— 読んだら保存まで一気通貫

旧UIの問題：「読み取り結果（6件）」を表示するだけで**保存導線も取引先欄も無かった**（プレビュー止まり）。
これを解消し、読み取り結果の直下に**注文ごとの保存セクション**を出す。

```
[読み取り結果（注文N件）]
 └ 注文1
    ├ 明細プレビュー表（読取り原文/商品名/数量/単位/確信度）
    └ ▼ 保存セクション（OcrSaveSection）
        取引先（店舗名）  [▼ AI読取:◯◯◯ で自動選択]  ← 6-2
        納品日           [____-__-__]（AI読取りでプリセット・必須）
        ┌ 明細編集表 ──────────────────────────┐
        │ 読取原文 │ 商品(▼選択) │ 数量 │ 単位 │  ← 行ごと修正可
        └────────────────────────────────────┘
        [ 注文として保存 ] ← 決定ボタン。POST /api/orders
```

- **1注文単位**で「注文として保存」ボタンを置く（マトリックス/複数日付は注文ごとにカード分割）。
- 保存先：`POST /api/orders`（手動入力は admin 直接確認扱いで `status='approved'`）。
- 保存後：トースト→`/admin/orders` へ遷移＋`router.refresh()`。
- バリデーション：取引先未選択／納品日空／商品未選択・数量≤0 はトーストで止める（誤登録防止）。
- **赤=危険を一目で**：confidence<0.7 行・名寄せ失敗・数量2.5倍超は赤背景＋⚠️で要確認を促す。

### 6-2. 取引先（店舗名）フィールド — 必須・自動マッチ・手修正可

旧UIに無かった**店舗名（取引先）欄を追加**。これが無いと「誰の注文か」が確定せず保存できない。

- AIが読み取った `customer_name` を表示し、**取引先マスタから自動で前選択**（部分一致 fallback）。
- ラベルに「（AI読取: ◯◯◯）」を併記し、AIの読みと選択結果のズレを人が気づけるようにする。
- 自動マッチに失敗しても**プルダウンから手選択**でき、必ず一意の `customer_id` に確定させる。
- 将来：選択した取引先を `customers.channel_identifiers.fax` に学習させ、次回の自動マッチ率を上げる。

### 6-3. pending_review 一覧（自動取り込み分の受け皿）

自動パイプライン（§7で auto-approve を通らなかった分）は `pending_review` で滞留する。
admin/inbox で**未処理の山を可視化**し、各受信を 6-1 と同じ確認UIで承認できるようにして取りこぼしを防ぐ。

---

## 7. 自動承認ゲート（`lib/ingestion/auto-approve.ts`・実装済の思想を厳守）

**全条件ANDでのみ自動承認**。1つでも欠ければ pending_review。

```
1. 設定で自動承認ON
2. 全明細 confidence ≥ 閾値（既定1.0＝100%）
3. 取引先が一意に紐付く（未紐付けは人手・失敗#6）
4. 納品日が確定（不明は人手・失敗#7）
5. 全明細が商品マスタに名寄せ成功
```

- 閾値は設定可（`parseThreshold`）。導入初期は**自動承認OFFで運用**し、
  「AIの提案 vs 人の確定」を貯めてから段階的に閾値を下げる/ONにする。
- 誤承認しても修正は learning に入り、**時間とともに自動承認が安全になる**設計。

### 7-2. スキーマ依存の整理（G6の決定）

自動承認で `orders`/`order_items` に INSERT する際、**存在しないカラムを使わない**。

| 当初コードの依存 | 状態 | 決定 |
|---|---|---|
| `orders.receipt_id` | ❌ 無い | 使わない。受信↔注文の連携は既存 `order_receipts.order_id`（解析後にUPDATE）で行う |
| `orders.is_revision` | ❌ 無い | 使わない。再送は §7-3 で別扱い（そもそも自動承認しない） |
| `order_items.quantity_raw` | ❌ 無い | **マイグレーション 0012 で追加**（`TEXT`）。生表記保持は features.md §5 の要件 |
| `order_items.confidence` / `is_flagged` | ✅ 有る（0002） | そのまま使う |
| `orders.source` | ✅ 有る（0001・CHECK fax/email/portal/manual） | `source='fax'` 等を入れる |
| `increment_receipt_retry` RPC | ❌ 無い | RPCを作らず、`retry_count` は現在値+1をUPDATEで書く |

> マイグレーション 0012（最小）:
> ```sql
> ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity_raw TEXT; -- AI読取りの生数量表記
> ```

### 7-3. 再送（revision）の扱い — 二重計上を防ぐ（G8の決定）

取引先は「前回FAXに行を足して**丸ごと再送**」する（features.md §3）。
`decideReceiptDisposition` が `'revision'` を返した受信を、当初コードは**新規 order として作成**していた＝
**同じ注文を二重計上**する重大な穴。決定：

- **revision は自動承認しない**。`disposition==='revision'` なら confidence が高くても必ず `pending_review`。
- 検証UIに**親注文（同一 sender_date_key の既存 order）との差分**を見せ、人が
  「追加/変更/削除」を確認して**既存注文に反映**（features.md §3：差分を既存へ加算/更新、変更は audit_log）。
- 自動での差分マージ（analyzeDiff の added/modified/removed 適用）は誤相殺リスクが高いので、
  **当面は人手レビュー前提**。学習が十分貯まってから自動マージを検討。

---

## 8. コスト・無料枠管理（G4：`canRunGemini` を実装）

features.md §4 の優先度キューを実装で担保する。

```
P1 即時 : ポータル/手動（そもそもGemini不要 or 即時）
P2 5分  : FAX・メール画像（OCR必須）
P3 バッチ: 差分の低確信度再解析・週次

残200 → P3停止 ／ 残50 → P2停止＋通知 ／ 残0 → 自動解析停止・手動受付のみ
```

- `gemini_usage_log` を毎回記録（実装済 `logUsage`）。日次/分次カウントで `canRunGemini(priority)` を判定。
- 枯渇時は**自動を止めて手動受付にフォールバック**（業務は止めない）。残50/0で Discord/LINE WORKS 通知（features.md §9-2）。
- トークン削減：§3 前処理での縮小・JPEG化、非受注の早期除外、ポータル普及でOCR母数を減らす。

---

## 9. 失敗時の挙動（リトライ・フォールバック・G1/G5）

### 9-1. poll-drive への解析配線（G1）

```
pending_ai の order_receipts を quota ゲート(canRunGemini('P2'))で1件ずつ:
  R2原本 → §3前処理 → analyzeOrders → §5検証 → §7判定
  成功 : status を pending_review / approved に更新、order_id 紐付け
  失敗 : status='ai_failed', retry_count++, next_retry_at=now+backoff, error_message 記録
```

### 9-2. リトライ戦略（指数バックオフ・G10の決定）

```
失敗時: status='ai_failed', retry_count++, error_message 記録,
        next_retry_at = now + backoff(retry_count)   // 5分→30分→3時間
cron（poll-drive/poll-email）は毎回、pending_ai に加えて
  「ai_failed かつ next_retry_at <= now かつ retry_count < 3」の受信も再投入する。
retry_count >= 3 で打ち切り → status は ai_failed のまま残し、通知＋手動再解析ボタン。
```

| 失敗種別 | 対応 |
|---------|------|
| Geminiタイムアウト/5xx | 上記バックオフで最大3回。超過で `ai_failed` 確定＋通知 |
| JSON不正 | `extractJson` 再パース→失敗で `ai_failed`（次回cronで再解析） |
| `is_order:false`＋画像あり | **180°回転して1回再試行**（上下逆さまFAX救済）。実装済 |
| 取引先未紐付け | `status='unmatched'`＋手動紐付けUI（failure#6） |
| 総数確定不能（c記法×P/C無） | `pending_review`（人手で総数確定・§5-2） |
| quota枯渇 | 解析せず `pending_ai` のまま保留、復帰後に再開 |

### 9-3. 全体フォールバック（features.md §10-#10）

システム全断時は週1配信の「定番注文リストPDF」で**紙運用に切戻し**可能にしておく。

---

## 10. 観測性 — 「効いているか」を測る

改善は計測なしには回らない。最低限のメトリクスを `order_receipts` / `gemini_usage_log` から集計。

| 指標 | 定義 | 目標感 |
|------|------|--------|
| 自動承認率 | approved(auto) / 全受信 | 学習が進むほど上昇 |
| 人手修正率 | 人が値を直した行 / AI抽出行 | 低下＝精度向上 |
| 取りこぼし | pending_review の滞留時間・件数 | 翌営業日までに0 |
| 誤承認（重大） | 出荷後に判明した受注ミス | **0が絶対目標** |
| quota消費 | 日次 req 数・残量 | 枯渇前に検知 |
| 非受注除外率 | is_order:false / 全FAX | 妥当か監視（過剰除外は危険） |

- **誤りサンプルの定期レビュー**：人手修正された行を週次で見て、前処理/プロンプト/学習に反映。
- 重要なのは**誤承認＝0**。再現したら原因（前処理 or プロンプト or 名寄せ or 数量）を切り分けて潰す。

---

## 11. 実装ロードマップ

```
■ 第1次（完了）— 自動パイプラインの骨格
  ✅ G2 analyzeOrders(orders[]) 統一・hintText 注入
  ✅ G3 lib/ocr/preprocess.ts（grayscale/normalize/resize/jpeg＋180°）
  ✅ G4 canRunGeminiNow() quotaゲート
  ✅ G1 process-receipt.ts ＋ poll-drive/poll-email 配線

■ 第2次（要対応）— 自動承認をONにする前に潰す残課題
  □ G6 マイグレーション 0012（order_items.quantity_raw）。INSERTから receipt_id/is_revision を除去、
       連携は order_receipts.order_id、retry_count は現在値+1のUPDATE
  □ G7 saveOrder / OcrSaveSection で parseQuantity を呼び total を quantity に。error は pending_review
  □ G8 disposition==='revision' は自動承認せず pending_review（差分レビュー）。二重計上を断つ
  □ G9 preprocess が application/pdf を素通し（Gemini ネイティブPDF）
  □ G10 ai_failed の next_retry_at バックオフ再投入を cron に追加

■ 第3次（観測・上積み）
  □ §10 メトリクス集計ビュー＋週次の誤りレビュー運用
  □ 重要取引先のみ2回読み一致確認、responseSchema 強制、deskew/二値化（効果次第）
```

### 設計判断ログ

| 判断 | 採用 | 理由 |
|------|------|------|
| 出力形式 | `orders[]` 統一 | マトリックス/複数日付で文脈を失わない |
| 領域分割OCR | やらない | レイアウト崩れに弱い。LLMに全体構造を解かせる |
| 前処理エンジン | sharp(Node) | Cloud Run一体型・高速・依存軽い |
| PDF | 当面Geminiネイティブ | sharpが読めない。精度不足まで画像化しない（G9） |
| 数量 | 保存時にparseQuantity・生表記も保持 | 誤った総数で自動入力しない（G7） |
| 再送(revision) | 自動承認せず差分レビュー | 二重計上・誤相殺を断つ（G8） |
| 受信↔注文連携 | order_receipts.order_id | orders に receipt_id を足さない（G6） |
| 自動承認 | 初期OFF→段階解放 | 誤承認0を最優先。学習を貯めてから |
| confidence | 外部検証で裏取り | 自己採点は不正確（auto-approve.ts の前提） |
| 全件証跡 | R2原本＋receipts | 監査・再解析・紙切戻しの基盤 |

## 関連
- `.claude/rules/features.md` — 上位仕様（§0全体像 / §3再送 / §4 Gemini / §5スマートパース）
- `lib/gemini/analyze.ts`, `lib/gemini/prompts.ts` — 抽出実装
- `lib/matching/name-match.ts`, `lib/calculations/parse-quantity.ts` — 検証実装
- `lib/ingestion/auto-approve.ts`, `lib/ingestion/learning.ts` — 判定・学習
- `lib/receipts/dedupe.ts` — 重複・再送判定
- `app/api/cron/poll-drive/route.ts` — 自動取り込み（解析配線が未実装＝G1）
- `components/admin/ManualOcrForm.tsx`, `components/admin/OcrSaveSection.tsx` — 手動UI
