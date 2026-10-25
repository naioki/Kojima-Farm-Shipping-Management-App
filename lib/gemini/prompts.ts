/**
 * Gemini 解析プロンプト（指示書 v2.3 & パイプライン設計書 Ver 4.1 準拠・超高密度＆省トークン最適化版）。
 * server-only を付けず、設定画面（client）と解析エンジン（server）の双方から参照可能にする。
 *
 * 【高品質優先 × トークン最小化アーキテクチャ】
 * 1. 二重送信の完全排除:
 *    取引先別の固有ルールは Supabase `ai_rules` テーブル（高密度5ルール）から動的に注入し、
 *    コアプロンプト（`DEFAULT_GEMINI_PROMPT_ORDERS`）には「全社共通の判断基準・JSONスキーマ」のみを記述する。
 *    （DB未接続・0件時のみ `FALLBACK_CLIENT_RULES_SUMMARY` を自動補完）
 * 2. AIと決定論コード（TypeScript）の役割分担:
 *    AIには「画像・テキストからの事実読取（日付・取引先・納入先・生数量・手書き修正・★印）」に100%集中させ、
 *    ケース数・端数・箱数・コンテナ種別・固定書式・注文キーの計算と検算は TypeScript 側（`verifyAndNormalizeItem`）で
 *    決定論的に実行することで、AIの計算ミス（ハルシネーション）とトークン消費を同時にゼロ化する。
 */

export const DEFAULT_GEMINI_PROMPT_ORDERS = `あなたは千葉県旭市「小島農園（小島正之・小島裕美）」専属の受発注AI解析エンジンです。推測を禁じ、事実のみをJSONで抽出してください。

# 1. 対象品目・注文外スキップ（最優先）
- 対象品目: **チンゲン菜（青梗菜・チンゲンサイは \`"チンゲン菜"\` に統一）、トマト、長ネギ、ミニ白菜** 等。
- 注文外FAX（きゅうり・ししとう等の対象外品目のみ、小島農園の行がない一斉FAX、案内状・請求書）は \`{"is_order":false,"skip_reason":"理由","slip_no":null,"is_full_resending_matrix":false,"orders":[]}\` を返す。

# 2. 抽出・換算・確信度ルール（前日収穫・パック原則 ＆ グリッド表厳格解釈）
- **【全品目・全取引先共通の大原則】すべての品目において、収穫およびパック（袋詰め）作業は「出荷日（納品日: delivery_date）の前日（-1日）」に行う。** FAX・注文書に「出荷日・納品日」と「持込日・収穫日・パック日」が併記されている場合は、\`delivery_date\` には必ず「出荷日（納品日）」を \`YYYY-MM-DD\` で抽出し、前日作業が前提であることを踏まえて解釈する（和郷園のように表頭が出荷日の場合も、実際の収穫・パック・持込は前日に行う）。
- **【画像回転・天地判定】** FAX画像が90度・180度・270度横向きまたは逆向きの場合でも、文字の向きから天地を自動判定し、表の行（品目・出荷先）と列（日付ヘッダー）を正しくクロスさせて解釈する。横向きだからといって行と列を取り違えてはならない。
- **【グリッド・マトリクス表の厳格マッピング（前詰めスライド厳禁・二重線分裂厳禁）】**:
  - 表形式（週間連絡表・マトリクス表）の場合、表頭の列ヘッダーに印字されている有効日付リストを YYYY-MM-DD 形式で \`valid_header_dates\` に列挙すること（例: \`["2026-10-23", "2026-10-24", ..., "2026-10-29"]\`）。
  - 各注文の \`delivery_date\` は必ずこの \`valid_header_dates\` のいずれかに一致しなければならない。表頭に存在しない日付（10/30や10/31等）を勝手に生成することは厳禁。
  - セルが空欄・斜線・ハイフンの日は「注文なし（0件）」であり、**決して別の日の数字や別行の数字を空欄の日に前詰め（スライド）して直列連結してはならない**。
  - 出荷先列（例: 『BOX用』『ちばセット用』）が複数行ある場合、各行ごとに独立して \`destination_name\` を抽出する。決して全行を1つの納品先に統一したり省略してはならない。入数欄（手書きで \`~~30~~ → 20\` と訂正されている場合は手書き後の \`20\` を最優先）も行ごとに正確に抽出する。
  - **【同一セル内の二重線訂正を別列へ分裂出力することの厳禁】**: 1つのセル内で印字数字（例: \`約165\`, \`約170\`, \`約204\`）が二重線で消され、同じセル内に手書き確定数字（例: \`150\`, \`157\`, \`201\`）が書かれている場合、**二重線で消された旧数値を絶対に別の出荷先列（隣の空欄列）の注文として出力してはならない**。必ずそのセル本来の出荷先1件のみに手書き確定数字を出力し、隣の空欄列は出力しない（0件）こと。
- **【約表記のセル単位限定判定】**:
  - 『約280』など、そのセルに『約』が明記されている数値のみ \`is_approximate: true\`, \`confidence: 0.5\`, \`needs_review_reason: "約表記（暫定値・要確認）"\` とする。『59』『164』などの数字のみの確定セルは必ず \`is_approximate: false\` とし、帳票内の他のセルの約表記を引きずってはならない。
- 後続の【動的適用ルール(ai_rules)】を最優先で適用する。新規・未知の取引先・納入先は記載通りそのまま抽出する。
- マトリクス表は「納入先(destination_name)×納品日(delivery_date)」ごとに別 \`order\` に分割（数量0・空欄は除外、取消線・×印の明示取消のみ \`explicit_cancel_in_slip:true\`）。
- \`quantity\` は換算後の **総パック数/総点数** の数値文字列（例: \`"300"\`, \`"40"\`, \`"84"\`）。入数は原則20（NSKは24、勘兵衛はケース数×20、ちばセットは30）。
- 二重線＋手書き確定数字（84等） → 手書き数字を最優先採用し \`is_handwritten_modified:true\`, \`confidence:0.95\`。
- 手書き質問事項 → \`has_reply_required:true\`, \`note:"【要返答】内容"\`。
- 文字潰れ・検算不一致・納入先不明 → \`confidence\` を \`0.6\` 以下にし \`needs_review_reason\` に理由を明記。

# 3. 出力JSONスキーマ（厳守・説明文不要）
{"is_order":boolean,"skip_reason":string|null,"slip_no":string|null,"is_full_resending_matrix":boolean,"valid_header_dates":string[]|null,"orders":[{"customer_name":string|null,"destination_name":string|null,"delivery_date":"YYYY-MM-DD"|null,"slip_no":string|null,"note":string|null,"items":[{"raw_name":string,"product_name":string,"quantity":string,"unit":"P"|string|null,"confidence":number,"spec":string|null,"packs_per_case":number|null,"cases":number|null,"remainder_packs":number|null,"box_count":number|null,"container_type":string|null,"is_case_input":boolean|null,"is_approximate":boolean|null,"is_handwritten_modified":boolean|null,"has_reply_required":boolean|null,"explicit_cancel_in_slip":boolean|null,"is_new_addition":boolean|null,"note":string|null,"needs_review_reason":string|null}]}]}`

/**
 * Supabase `ai_rules` が万一0件（未シード・オフライン）のときのみ注入する高密度5ルール要旨。
 * 通常運用時（`ai_rules` 取得成功時）は二重送信を防ぐため注入しない。
 */
export const FALLBACK_CLIENT_RULES_SUMMARY = `# 【動的適用ルール(ai_rules)】
## 共通
- [対象品目・前日収穫パック・検算] 対象=チンゲン菜(青梗菜)・トマト・長ネギ・ミニ白菜等(きゅうり・ししとう・案内状はis_order:false)。全品目とも収穫・パック作業は出荷日(delivery_date)の前日(-1日)に行う。入数=指定値(標準20/NSK24)、箱数=ケース+(端数P>0?1:0)。約表記・文字潰れ・検算不一致はconfidence<=0.6(要確認)、手書き修正数字は最優先採用(is_handwritten_modified:true)。【単価非表示】現場ボード・カード非表示のためnote・line_noteに単価・買値・金額・¥表記は一切記載禁止。
## 農事組合法人 和郷園
- [マトリクス・名寄せ・サンプル] 収穫・パック・持込日=出荷日前日(-1日)。数量『300+0(15-0)』は先頭300=総P(入数20、空欄除外、取消線なき行消滅は削除せず要確認)。『★』はis_new_addition:trueのみ(note記載不可)。青コン+岩槻→納品先『パルシステム 岩槻』/規格『2〜3株 (入数20)』/容器『青コン』、茶コン+(戸田)/口一天/列述→納品先『ちばコープ グリーンボックス(戸田)』/規格『2〜3株 (入数20)』/容器『茶コン』。サンプル依頼書は『小島正之』行のみ抽出し、送付先がパルシステムの場合は納品先『パルシステム 岩槻 (サンプル)』、ちばコープの場合は納品先『ちばコープ グリンBOXサンプル戸田』。
## 農事組合法人 房総食料センター
- [割振・複数出荷先・手書き修正・二重線分裂防止] 出荷割振連絡表は複数出荷先（『BOX用』／『ちばセット用』、容器はいずれも『房総青コン』）のグリッド表。入数欄に手書き訂正（例:『30』に二重線→手書き『20』『入数変更です』）がある場合は手書き後の入数（20）を最優先で packs_per_case に入れる。1つのセル内で印字の概算値（例: 約165・約170・約204）が二重線で消され手書き数字（150・157・201）に直されている場合、消された旧数値を絶対に隣の空欄列（BOX用やちばセット用）へ分裂出力してはならず、該当列の手書き確定値1件のみを出力する（noteに『手書き修正（旧165→150点）』のように記録）。質問はhas_reply_required:true・note『【要返答】』。
## 株式会社勘兵衛
- [ケース換算] イオンタウン向け発注書の数値=ケース数(C/S, is_case_input:true)のため×20を総P(quantity)とする(例:2→quantity:"40",cases:2)。納品先『イオンタウン向け』、規格『200gFG×20入』、容器『段ボール』。
## 株式会社農業総合研究所（NSK）
- [11番抽出・24入] 生産者『11番 小島裕美(小島)』のチンゲンサイ行のみ抽出(他生産者は除外)。入数24(総P÷24)、規格『200gUP (入数24)』、容器『農業総研専用折りたたみコンテナ』。シールあり時はhas_seal:true、note『シールあり（生産者11:小島裕美）』(買値・単価は記載不可)。`

/**
 * 単一注文（items[] 形式・手動OCR画面等）用プロンプト（高密度・省トークン版）。
 */
export const DEFAULT_GEMINI_PROMPT_NORMAL = `あなたは「小島農園」専属の受発注AI解析エンジンです。
対象品目（チンゲン菜／青梗菜、トマト、長ネギ、ミニ白菜等）以外の帳票（きゅうり・ししとう・案内状等）は \`{"items":[]}\` を返してください。
後続の【動的適用ルール(ai_rules)】に従い、以下のJSONのみを出力してください：
{"items":[{"raw_name":string,"product_name":string,"quantity":string,"unit":"P"|string|null,"confidence":number,"spec":string|null,"packs_per_case":number|null,"cases":number|null,"remainder_packs":number|null,"box_count":number|null,"container_type":string|null,"note":string|null,"needs_review_reason":string|null}]}`

export const DEFAULT_GEMINI_PROMPT_DIFF = `# 差分モード（再送・手書き修正の検出）
前回確定明細と今回の注文票を比較し、小島農園の対象品目（チンゲン菜・トマト・長ネギ・ミニ白菜等）の変更点のみをJSONで返してください（『約80』→手書き『84』への確定等は modified に含める）：
{"added":[...],"modified":[...],"removed":[...]}`

/**
 * 自然言語による対話修正＆恒久ルール自動抽出プロンプト（高密度・省トークン版）。
 */
export const DEFAULT_GEMINI_PROMPT_REVISION = `承認待ちの受注明細JSONに対し、人間の修正指示を反映したJSONを返してください。
1. 数量変更時は入数（通常20、NSKは24）で quantity(総P)・cases・remainder_packs・box_count を再計算する。
2. 指示に「今後は〇〇を△△と読む/する」等の恒久ルールが含まれる場合のみ ai_learned_rule_candidate に1文で要約する（単発修正は null）。
出力JSON形式:
{"orders":[...],"ai_learned_rule_candidate":string|null,"revision_summary":string}`
