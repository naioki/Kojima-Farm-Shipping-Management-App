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

### 今すぐ直すべき構造的問題（現状コードのギャップ）

| # | 問題 | 現状 | 対策章 |
|---|------|------|--------|
| G1 | 自動取り込みの解析が未配線 | `poll-drive/route.ts:99` が `pending_ai` を作るだけで Gemini を呼ばない | §2, §9 |
| G2 | プロンプトが2系統に分岐 | 手動=`orders[]`新形式 / 自動=`items[]`旧形式。マトリックスFAXは自動側で壊れる | §4 |
| G3 | 画像前処理が自動側に無い | 手動はブラウザ縮小のみ。poll-drive は生バイトをそのまま送信 | §3 |
| G4 | quotaゲート未実装 | `canRunGemini` が存在せず無料枠枯渇を防げない | §8 |
| G5 | 多ページFAX・回転・歪み未対応 | 単一画像前提 | §3 |

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

### 3-1. 標準パイプライン

```
入力(画像/PDF各ページ)
  → 1. デコード・EXIF回転補正
  → 2. グレースケール化
  → 3. 自動傾き補正（deskew：±15°のハフ変換 or 投影プロファイル）
  → 4. コントラスト強調（CLAHE相当）＋ノイズ除去（メディアン）
  → 5. 二値化（適応的しきい値。マトリックス罫線は残す）
  → 6. 長辺 1600px へリサイズ（features.md §4：1200×1600目安）
  → 7. JPEG q80 で base64 化（Geminiトークン・転送量を抑制）
```

- **PDF**：ページ分割してページ単位で処理。Geminiは複数ページをネイティブ解釈できるが、
  巨大PDFはトークンを食うので「ページ→画像化→前処理→結合」が確実。
- **回転（上下逆さま）**：deskewでは直らない180°は、1回目の抽出が `is_order:false`＋低confidenceに
  なったら180°回転して再試行する（§9 リトライ）。
- **実装方針**：Cloud Run(Node)上で `sharp`（ネイティブ高速）を基本に。重度の歪みのみ将来 OpenCV.wasm。
  手動側の既存 `lib/image/downscale`（ブラウザ縮小）はそのまま入口圧縮として残し、サーバ側で本処理。

### 3-2. やってはいけないこと

- 過度な二値化で**かすれ文字を消す** → 逆に誤読が増える。原画像も必ずGeminiに渡せるよう保持。
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

### 5-2. 数量の整合検証（実装済ロジックを前段へ流用）

- `parse-quantity.ts` で生表記→総数へ（Decimal.js、浮動小数点禁止／tax.md）。
- **過去90日の同取引先×商品の最大値**と比較（`app/api/orders` 既存ロジック）。
  2.5倍超は `warning` として**赤フラグ**（保存は止めない＝誤検知で業務を止めない）。
- `customer_product_rules.packs_per_case`（P/C）が既知なら "15c2" の端数2が P/C 未満かを検算。

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

### 9-2. リトライ戦略（指数バックオフ）

| 失敗種別 | 対応 |
|---------|------|
| Geminiタイムアウト/5xx | 指数バックオフで最大3回。超過で `ai_failed`＋通知 |
| JSON不正 | `extractJson` 再パース→失敗で1回だけ再解析→なお失敗で人手 |
| `is_order:false`＋全行低confidence | **180°回転して1回再試行**（上下逆さまFAX救済） |
| 取引先未紐付け | `status='unmatched'`＋手動紐付けUI（failure#6） |
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

## 11. 実装ロードマップ（現状からの差分）

```
Step 1（G2解消・低リスク）
  - 自動側の新規解析を analyzeOrders(orders[]) に統一。analyzeNormal は差分再送専用に縮退。

Step 2（G3・最大効果）
  - lib/ocr/preprocess.ts を新規。sharp で grayscale/deskew/contrast/resize/jpeg。
  - 手動・自動の両入口から通す。原画像も保持しGeminiに渡せるように。

Step 3（G1・自動化の本丸）
  - poll-drive の TODO を実装：pending_ai → 前処理 → analyzeOrders → 検証 → auto-approve。
  - learning ヒントを analyzeOrders に注入。

Step 4（G4・コスト安全弁）
  - canRunGemini(priority) を gemini_usage_log カウントで実装。枯渇時フォールバック＋通知。

Step 5（観測）
  - §10 メトリクスの集計ビュー。週次の誤りレビュー運用を開始。

Step 6（精度の上積み・任意）
  - 重要取引先のみ2回読み一致確認。responseSchema による構造化出力強制。
```

### 設計判断ログ

| 判断 | 採用 | 理由 |
|------|------|------|
| 出力形式 | `orders[]` 統一 | マトリックス/複数日付で文脈を失わない |
| 領域分割OCR | やらない | レイアウト崩れに弱い。LLMに全体構造を解かせる |
| 前処理エンジン | sharp(Node) | Cloud Run一体型・高速・依存軽い |
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
