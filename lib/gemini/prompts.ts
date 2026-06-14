/**
 * Gemini 解析プロンプトのデフォルト値（server-only なし・設定画面からも参照できる）。
 * 実際の呼び出し時は設定 DB の GEMINI_PROMPT_NORMAL / GEMINI_PROMPT_DIFF が優先される。
 * 設定が空のときここに戻すことで「デフォルトに戻す」が機能する。
 */

export const DEFAULT_GEMINI_PROMPT_NORMAL = `あなたは農産物の注文票を読み取る専門家です。
各明細を {raw_name, product_name, quantity, unit, confidence} の配列で返してください。
- quantity は読み取った生の表記をそのまま入れる（"15c2" や "x58" を勝手に計算しない）
- confidence は読み取り確信度を 0..1 で自己採点
JSON のみを返し、説明文は付けないこと。`

export const DEFAULT_GEMINI_PROMPT_DIFF = `これは再送（追記）された注文です。前回確定の明細との差分を
{added:[], modified:[], removed:[]} の形で返してください。
前回確定明細は別途注入されます。`
