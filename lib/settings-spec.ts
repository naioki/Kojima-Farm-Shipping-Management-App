/**
 * 設定画面で扱うキーの仕様（クライアント/サーバ共有・純データ）。
 * 秘密情報は secret=true。画面は値を返さず「設定済み/未設定」だけ表示する。
 * 実値の解決は lib/settings.ts（サーバ専用・DB→env フォールバック）が行う。
 *
 * 【2026-10 整理反映】
 * 1. 現場や運用に不要なダミー設定（未使用の遅れ通知、旧IMAP設定、不要なスタッフ微細トグル等）を全撤去。
 * 2. 目的別の6区分（2026-11 再整理。ふだん触る順に並べ、触らない区分は畳む）：
 *    - issuer: 自社情報（請求書・納品書の印字）
 *    - staff: 現場スタッフに任せること（機能の解放）
 *    - ai: AI読み取り・自動承認
 *    - notify: 通知（LINE WORKS）
 *    - integration: 外部連携のキー（Kojima-FAX・Gemini・cron）※畳む
 *    - advanced: プロンプト・PDFフォント ※畳む
 */

import { DELIVERY_AMOUNT_MODES } from '@/lib/delivery-notes/amount-mode'
import { DEFAULT_GEMINI_PROMPT_NORMAL, DEFAULT_GEMINI_PROMPT_DIFF } from '@/lib/gemini/prompts'
import { GEMINI_HIGH_MODEL_OPTIONS, GEMINI_MODEL_OPTIONS } from '@/lib/gemini/models'

export type SettingSection = 'issuer' | 'staff' | 'ai' | 'notify' | 'integration' | 'advanced'
export type SettingKind = 'text' | 'textarea' | 'toggle' | 'select' | 'prompt'

export interface SettingSpec {
  key: string
  label: string
  section: SettingSection
  secret: boolean
  kind: SettingKind
  placeholder?: string
  hint?: string
  toggleDefault?: 'on' | 'off'
  options?: { value: string; label: string }[]
  selectDefault?: string
  defaultPrompt?: string
  dependsOn?: { key: string; equals: string }
  danger?: boolean
}

export const SECTION_ORDER: SettingSection[] = ['issuer', 'staff', 'ai', 'notify', 'integration', 'advanced']

/** ふだん触らない区分（最初は畳んで表示する） */
export const COLLAPSED_SECTIONS: SettingSection[] = ['integration', 'advanced']

export const SECTION_LABELS: Record<SettingSection, string> = {
  issuer: '自社情報（納品書・請求書に印字）',
  staff: '現場スタッフに任せること',
  ai: 'AI読み取りと自動承認',
  notify: '通知（LINE WORKS）',
  integration: '外部連携のキー（FAXサーバー・Gemini・定期実行）',
  advanced: '上級者向け（AIへの指示文・PDFフォント）',
}

export const SECTION_DESCRIPTIONS: Record<SettingSection, string> = {
  issuer: '納品書・請求書に印字される小島農園の情報です。一度入れれば、ふだん変える必要はありません。',
  staff: '現場スタッフの画面で使える機能を選びます。オフにした機能はスタッフの画面に出ません（管理者は常に使えます）。',
  ai: 'FAXや写真を読み取るAIと、問題のない注文を自動で承認するかどうかを決めます。',
  notify: '読み取りの失敗・要確認・出荷遅れなどのお知らせを LINE WORKS のグループに送ります。',
  integration: 'FAXサーバー（Kojima-FAX）・Gemini・定期実行の合言葉です。保存後は値を表示しません（設定済み／未設定のみ）。',
  advanced: 'AIへの指示文（プロンプト）とPDFのフォントです。通常は変更不要です。',
}

/** 互換性維持のためのスタッフ機能キー（lib/field/features.ts で参照） */
export const STAFF_FEATURE_KEYS = {
  ocr: 'STAFF_CAN_OCR',
  createOrder: 'STAFF_CAN_CREATE_ORDER',
  reportSpec: 'STAFF_CAN_REPORT_SPEC',
  approve: 'STAFF_CAN_APPROVE',
  printDocs: 'STAFF_CAN_PRINT_DOCS',
} as const
export type StaffFeatureKey = (typeof STAFF_FEATURE_KEYS)[keyof typeof STAFF_FEATURE_KEYS]

export const SETTINGS_SPEC: SettingSpec[] = [
  // ──────────────────────────────────────────
  // ① 自社・請求書情報
  // ──────────────────────────────────────────
  {
    key: 'FARM_NAME',
    label: '事業者名（屋号）',
    section: 'issuer',
    secret: false,
    kind: 'text',
    placeholder: '小島農園',
    hint: '納品書や請求書の発行者名として印字されます。',
  },
  {
    key: 'FARM_INVOICE_REG_NUM',
    label: '適格請求書発行事業者 登録番号（インボイスT番号）',
    section: 'issuer',
    secret: false,
    kind: 'text',
    placeholder: 'T1234567890123',
    hint: 'インボイス制度の登録番号（T＋13桁）。請求書に印字されます。',
  },
  {
    key: 'FARM_ADDRESS',
    label: '住所',
    section: 'issuer',
    secret: false,
    kind: 'text',
    placeholder: '埼玉県さいたま市...',
    hint: '納品書や請求書に印字される所在地です。',
  },
  {
    key: 'FARM_TEL',
    label: '電話番号',
    section: 'issuer',
    secret: false,
    kind: 'text',
    placeholder: '048-000-0000',
    hint: '納品書や請求書に印字される連絡先電話番号です。',
  },
  {
    key: 'FARM_PAYMENT_INFO',
    label: '振込先口座情報',
    section: 'issuer',
    secret: false,
    kind: 'textarea',
    placeholder: '〇〇銀行 〇〇支店 普通 1234567\n口座名義: コジマ ノウエン',
    hint: '請求書の最下部に印字されるお振込先口座です。',
  },
  {
    key: 'DELIVERY_NOTE_AMOUNT_MODE',
    label: '納品書の金額表示（既定値）',
    section: 'issuer',
    secret: false,
    kind: 'select',
    options: DELIVERY_AMOUNT_MODES.map((m) => ({ value: m.value, label: m.label })),
    selectDefault: 'none',
    hint: '納品書発行時の初期表示。発行ごとに「金額あり／後から手書き／金額なし」を切り替えることもできます。',
  },

  // ──────────────────────────────────────────
  // ② AIモデルと自動確定
  // ──────────────────────────────────────────
  {
    key: 'GEMINI_MODEL',
    label: '① メインAIモデル（通常FAX読取・高速軽量）',
    section: 'ai',
    secret: false,
    kind: 'text',
    options: GEMINI_MODEL_OPTIONS,
    placeholder: 'gemini-3.5-flash-lite',
    hint: '日常のFAXや手書き文字の通常読み取りに使用するメインモデルです。自由に入力できます（空欄時は gemini-3.5-flash-lite）。',
  },
  {
    key: 'GEMINI_MODEL_HIGH',
    label: '② 重要箇所AIモデル（要確認の再検証・手書き修正・ルール学習）',
    section: 'ai',
    secret: false,
    kind: 'text',
    options: GEMINI_HIGH_MODEL_OPTIONS,
    placeholder: 'gemini-3.8-flash',
    hint: '確信度が低い場合や手書き修正、ルール学習など重要な場面のみ自動で呼び出される高精度モデルです。自由に入力できます。',
  },
  {
    key: 'AUTO_APPROVE_ENABLED',
    label: '承認の自動確定（問題のない注文は自動確定して現場へ連動）',
    section: 'ai',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    danger: true,
    hint: 'ONにすると、取引先・納品日が特定できAI確信度の高い注文は人間の承認を待たずに自動で確定し、出荷ボードへ反映されます。',
  },
  {
    key: 'AUTO_APPROVE_THRESHOLD',
    label: '自動確定するAI確信度のしきい値（0〜1、既定: 0.80）',
    section: 'ai',
    secret: false,
    kind: 'text',
    placeholder: '0.80',
    danger: true,
    hint: '0.80＝確信度80%以上の注文を自動確定し、要確認や文字潰れの注文のみ人間の確認に残します。',
    dependsOn: { key: 'AUTO_APPROVE_ENABLED', equals: 'on' },
  },

  // ──────────────────────────────────────────
  // ③ 通知と外部連携
  // ──────────────────────────────────────────
  {
    key: 'LINE_WORKS_WEBHOOK_URL',
    label: 'LINE WORKS Incoming Webhook URL（※通知の送信先）',
    section: 'notify',
    secret: true,
    kind: 'text',
    placeholder: 'https://wh.worksmobile.com/...',
    hint: '【重要】FAX読み取りエラーや要確認などのアラート通知は、ここに設定されたLINE WORKSグループに届きます。',
  },
  {
    key: 'NOTIFY_LINEWORKS_ENABLED',
    label: 'LINE WORKS 通知を有効にする',
    section: 'notify',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'on',
    hint: 'ONにすると、注文の要確認やFAX読み取りエラー発生時に上記Webhookへ即座に通知メッセージが送信されます。',
  },
  {
    key: 'FAX_INGEST_TOKEN',
    label: 'Kojima-FAX 連携トークン（X-Pipeline-Token）',
    section: 'integration',
    secret: true,
    kind: 'text',
    placeholder: '（空欄の場合は認証なしで接続可能）',
    hint: '農園のFAX機（LIFEBOOK Kojima-FAX）の送信設定画面と一致させる認証キーです。',
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini APIキー',
    section: 'integration',
    secret: true,
    kind: 'text',
    hint: 'Google AI Studio で取得したAPIキーです。未入力の場合は環境変数から解決されます。',
  },

  // ──────────────────────────────────────────
  // ④ スタッフ権限・高度なシステム設定（通常は変更不要）
  // ──────────────────────────────────────────
  {
    key: 'STAFF_CAN_OCR',
    label: '現場スタッフの写真・FAX自動読取（OCR）を許可',
    section: 'staff',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'on',
    hint: 'ONにすると、現場スタッフも注文書やメモをカメラ・写真で読み取って注文追加できます。',
  },
  {
    key: 'STAFF_CAN_CREATE_ORDER',
    label: '現場スタッフの新規注文追加・変更を許可',
    section: 'staff',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'on',
    hint: 'ONにすると、現場スタッフも収穫・パックボードから注文追加や数量変更を行えます。',
  },
  {
    key: 'STAFF_CAN_APPROVE',
    label: '現場スタッフの注文承認（未確認注文の確定）を許可',
    section: 'staff',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'on',
    hint: 'ONにすると、現場スタッフもAI読取後の未確認注文を確認・承認できます。',
  },
  {
    key: 'STAFF_CAN_PRINT_DOCS',
    label: '現場スタッフの帳票・ラベル印刷を許可',
    section: 'staff',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'on',
    hint: 'ONにすると、現場スタッフも出荷指示書やラベルの印刷画面を利用できます。',
  },
  {
    key: 'STAFF_CAN_REPORT_SPEC',
    label: '現場スタッフの規格変更・現場報告を許可',
    section: 'staff',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'on',
    hint: 'ONにすると、現場スタッフも現場での規格変更や報告を送信できます。',
  },
  {
    key: 'CRON_SECRET',
    label: 'cron 共有シークレット',
    section: 'integration',
    secret: true,
    kind: 'text',
    hint: 'Cloud Scheduler 等からの定期実行呼び出しを認証するシークレットです。',
  },
  {
    key: 'PDF_FONT_URL',
    label: 'PDF 日本語フォントURL',
    section: 'advanced',
    secret: false,
    kind: 'text',
    placeholder: '空欄時は Noto Sans JP を自動使用',
    hint: '納品書・請求書PDF出力時の日本語フォントURLです。通常は空欄のままで問題ありません。',
  },
  {
    key: 'GEMINI_PROMPT_NORMAL',
    label: 'AI解析プロンプト（通常モード — FAX・画像）',
    section: 'advanced',
    secret: false,
    kind: 'prompt',
    danger: true,
    defaultPrompt: DEFAULT_GEMINI_PROMPT_NORMAL,
    hint: 'FAX・画像から注文を抽出する基本AI指示文です（取引先ごとのルールはマスタ管理から変更できます）。',
  },
  {
    key: 'GEMINI_PROMPT_DIFF',
    label: 'AI解析プロンプト（差分モード — 再送検知）',
    section: 'advanced',
    secret: false,
    kind: 'prompt',
    danger: true,
    defaultPrompt: DEFAULT_GEMINI_PROMPT_DIFF,
    hint: '手書き修正や追記FAXを検知した際の差分抽出用プロンプトです。',
  },
]

export const SETTINGS_BY_KEY: Record<string, SettingSpec> = Object.fromEntries(
  SETTINGS_SPEC.map((s) => [s.key, s]),
)

export const SECRET_KEYS = new Set(SETTINGS_SPEC.filter((s) => s.secret).map((s) => s.key))
