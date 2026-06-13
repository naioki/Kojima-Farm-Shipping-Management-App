/**
 * 設定画面で扱うキーの仕様（クライアント/サーバ共有・純データ）。
 * 秘密情報は secret=true。画面は値を返さず「設定済み/未設定」だけ表示する。
 * 実値の解決は lib/settings.ts（サーバ専用・DB→env フォールバック）が行う。
 */

export type SettingSection = 'issuer' | 'ai' | 'ingest' | 'storage' | 'notify' | 'ops'
export type SettingKind = 'text' | 'textarea' | 'toggle'

export interface SettingSpec {
  key: string
  label: string
  section: SettingSection
  secret: boolean
  kind: SettingKind
  placeholder?: string
  hint?: string
}

export const SECTION_LABELS: Record<SettingSection, string> = {
  issuer: '発行者（自社）情報 — 請求書・納品書に印字',
  ai: 'AI解析（Gemini）',
  ingest: '取り込み（Drive / メール）',
  storage: '保管（Cloudflare R2）',
  notify: '通知（Discord / LINE WORKS）',
  ops: '運用',
}

export const SECTION_ORDER: SettingSection[] = ['issuer', 'ai', 'ingest', 'storage', 'notify', 'ops']

export const SETTINGS_SPEC: SettingSpec[] = [
  // 発行者（自社）情報 — 請求書・納品書のヘッダーに印字
  { key: 'FARM_NAME', label: '事業者名', section: 'issuer', secret: false, kind: 'text', placeholder: '小島農園' },
  { key: 'FARM_INVOICE_REG_NUM', label: '適格請求書発行事業者 登録番号', section: 'issuer', secret: false, kind: 'text', placeholder: 'T1234567890123', hint: 'インボイス制度の登録番号（T＋13桁）' },
  { key: 'FARM_ADDRESS', label: '住所', section: 'issuer', secret: false, kind: 'text' },
  { key: 'FARM_TEL', label: '電話番号', section: 'issuer', secret: false, kind: 'text' },
  { key: 'FARM_PAYMENT_INFO', label: '振込先', section: 'issuer', secret: false, kind: 'textarea', hint: '請求書に印字する振込先口座' },
  // AI解析
  { key: 'GEMINI_API_KEY', label: 'Gemini APIキー', section: 'ai', secret: true, kind: 'text', hint: 'Google AI Studio で取得' },
  { key: 'GEMINI_MODEL', label: 'モデル', section: 'ai', secret: false, kind: 'text', placeholder: 'gemini-2.0-flash' },
  // 取り込み
  { key: 'DRIVE_FOLDER_ID', label: 'Drive フォルダID', section: 'ingest', secret: false, kind: 'text', hint: 'FAX画像が入る Google Drive フォルダのID' },
  { key: 'GOOGLE_SERVICE_ACCOUNT_JSON', label: 'Drive サービスアカウント鍵(JSON)', section: 'ingest', secret: true, kind: 'textarea', hint: 'Drive API 用サービスアカウントの鍵JSON全文' },
  { key: 'FAX_FILENAME_PATTERN', label: 'FAXファイル名規則', section: 'ingest', secret: false, kind: 'text', placeholder: '(?<fax>\\d{6,11})[_-](?<date>\\d{8})' },
  { key: 'IMAP_HOST', label: 'IMAP ホスト', section: 'ingest', secret: false, kind: 'text', placeholder: 'imap.example.com' },
  { key: 'IMAP_USER', label: 'IMAP ユーザー', section: 'ingest', secret: false, kind: 'text', placeholder: 'order@kojima-farm.jp' },
  { key: 'IMAP_PASSWORD', label: 'IMAP パスワード', section: 'ingest', secret: true, kind: 'text' },
  { key: 'ORDER_KEYWORDS', label: '注文キーワード', section: 'ingest', secret: false, kind: 'text', placeholder: '注文,発注,ご注文,オーダー' },
  // 保管
  { key: 'R2_ENDPOINT', label: 'R2 エンドポイント', section: 'storage', secret: false, kind: 'text', placeholder: 'https://xxxx.r2.cloudflarestorage.com' },
  { key: 'R2_BUCKET', label: 'R2 バケット', section: 'storage', secret: false, kind: 'text', placeholder: 'kojima-noen' },
  { key: 'R2_ACCESS_KEY_ID', label: 'R2 アクセスキーID', section: 'storage', secret: true, kind: 'text' },
  { key: 'R2_SECRET_ACCESS_KEY', label: 'R2 シークレットキー', section: 'storage', secret: true, kind: 'text' },
  // 通知
  { key: 'DISCORD_WEBHOOK_URL', label: 'Discord Webhook URL', section: 'notify', secret: true, kind: 'text' },
  { key: 'LINE_WORKS_WEBHOOK_URL', label: 'LINE WORKS Webhook URL', section: 'notify', secret: true, kind: 'text' },
  { key: 'NOTIFY_DISCORD', label: 'Discord通知', section: 'notify', secret: false, kind: 'toggle', hint: 'on / off' },
  { key: 'NOTIFY_LINE_WORKS', label: 'LINE WORKS通知', section: 'notify', secret: false, kind: 'toggle', hint: 'on / off' },
  // 運用
  { key: 'CRON_SECRET', label: 'cron 共有シークレット', section: 'ops', secret: true, kind: 'text', hint: 'Cloud Scheduler からの取り込み呼び出しを検証' },
]

export const SETTINGS_BY_KEY: Record<string, SettingSpec> = Object.fromEntries(
  SETTINGS_SPEC.map((s) => [s.key, s]),
)

export const SECRET_KEYS = new Set(SETTINGS_SPEC.filter((s) => s.secret).map((s) => s.key))
