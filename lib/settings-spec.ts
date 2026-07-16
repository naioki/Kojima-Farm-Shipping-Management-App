/**
 * 設定画面で扱うキーの仕様（クライアント/サーバ共有・純データ）。
 * 秘密情報は secret=true。画面は値を返さず「設定済み/未設定」だけ表示する。
 * 実値の解決は lib/settings.ts（サーバ専用・DB→env フォールバック）が行う。
 */

import { DELIVERY_AMOUNT_MODES } from '@/lib/delivery-notes/amount-mode'
import { DEFAULT_GEMINI_PROMPT_NORMAL, DEFAULT_GEMINI_PROMPT_DIFF } from '@/lib/gemini/prompts'
import { GEMINI_MODEL_OPTIONS } from '@/lib/gemini/models'

export type SettingSection = 'issuer' | 'rules' | 'field' | 'ai' | 'automation' | 'ingest' | 'storage' | 'notify' | 'chat' | 'ops'
/** 'prompt' は専用エディタで描画（保存に確認フレーズ入力が必要）。 */
export type SettingKind = 'text' | 'textarea' | 'toggle' | 'select' | 'prompt'

/**
 * 誰が・どのくらいの頻度で触るかで分けた4層（画面の大枠）。
 * profile: オーナーが設置時に1回。operations: オーナーが運用しながら時々調整。
 * infra: 構築者が一度きり接続する秘密情報・接続先。migration: 期間限定・上級者専用。
 */
export type SettingLayer = 'profile' | 'operations' | 'infra' | 'migration'

export interface SettingSpec {
  key: string
  label: string
  section: SettingSection
  layer: SettingLayer
  secret: boolean
  kind: SettingKind
  placeholder?: string
  hint?: string
  /** toggle の未設定時の既定（安全側に倒すため auto-approve は 'off'）。 */
  toggleDefault?: 'on' | 'off'
  /** kind==='select' の選択肢と未設定時の既定。 */
  options?: { value: string; label: string }[]
  selectDefault?: string
  /** kind==='prompt' のデフォルト値。「デフォルトに戻す」で使われる。 */
  defaultPrompt?: string
  /** 親トグルがこの値の時だけ表示（secretな親は値を持てないため対象外）。 */
  dependsOn?: { key: string; equals: string }
  /** ONにする/変更すると挙動が変わる項目。UIで⚠強調する。 */
  danger?: boolean
  /** 'planned' は未実装の枠。既定では一覧に出さない（「準備中を表示」で見える）。 */
  status?: 'active' | 'planned'
}

export const LAYER_LABELS: Record<SettingLayer, string> = {
  profile: '事業者プロフィール',
  operations: '運用チューニング',
  infra: '接続・インフラ（上級）',
  migration: '移行・メンテナンス（期間限定）',
}

export const LAYER_DESCRIPTIONS: Record<SettingLayer, string> = {
  profile: '請求書・納品書に印字される自社の情報です。設置時に1回決めれば、あとはほぼ変更しません。',
  operations: '現場解放・自動承認・通知など、運用しながら調整する項目です。挙動が変わる項目には⚠が付きます。',
  infra: 'APIキー・メール接続・保管先など、構築時に一度だけ設定する接続情報です。ふだんは開く必要はありません。',
  migration: '旧システムからの移行やAI解析プロンプトなど、期間限定・上級者向けの項目です。誤って変更すると影響が大きいので普段は開きません。',
}

export const LAYER_ORDER: SettingLayer[] = ['profile', 'operations', 'infra', 'migration']

export const SECTION_LABELS: Record<SettingSection, string> = {
  issuer: '発行者（自社）情報 — 請求書・納品書に印字',
  rules: '規格（取引ルール）の変更管理 — 誰が変えられるか・通知',
  field: '現場（スタッフ）機能の解放 — 段階的にON',
  ai: 'AI解析（Gemini）',
  automation: '自動承認（識字率が高い受信の自動入力）',
  ingest: '注文の取り込み（FAX画像 / メール）',
  storage: '保管（Cloudflare R2）',
  notify: '通知（Discord / LINE WORKS）',
  chat: 'チャット連携（Discord / LINE WORKS ボット）',
  ops: '運用',
}

/** 各セクションの先頭に出す1行説明（任意）。何のための設定かを平易に伝える。 */
export const SECTION_DESCRIPTIONS: Partial<Record<SettingSection, string>> = {
  issuer: '請求書・納品書の上部に印字される自社情報です。',
  rules: '取引先ごとの規格（P/C・荷姿など）を誰が変更できるか、変更時に通知するかを決めます。',
  field: '現場スタッフに開放する機能を1つずつONにできます。既定はすべてOFF（管理者のみ）。',
  ai: 'FAX・写真・メールから注文を読み取るAIの設定です。ふだんは「自動」のままでOK。',
  automation: '読み取り精度が高い受信を、人の確認なしで自動入力する設定です。安全のため既定はOFF。',
  ingest:
    'FAX画像やメールを自動で取り込むための接続先です。FAXソフトから転送された注文メールは、ここで指定したメールボックスを監視して取り込みます（FAXソフト側「送信に使うメール」と同じ箱を指定）。',
  storage: '受信したFAX/PDFの原本を保管するクラウドストレージ（Cloudflare R2）の接続情報です。',
  notify: '注文の受信などを Discord / LINE WORKS に知らせる設定です。',
  chat: 'Discord / LINE WORKS 上のボタンから承認・取込ができるチャットボットの接続設定です（上の「通知」とは別物）。',
  ops: '運用まわりの細かい設定です。ふだんは変更不要。',
}

export const SECTION_ORDER: SettingSection[] = ['issuer', 'rules', 'field', 'ai', 'automation', 'ingest', 'storage', 'notify', 'chat', 'ops']

/** 現場（スタッフ）機能トグルのキー。サーバ/クライアントで共有して可視性・権限を判定する。 */
export const STAFF_FEATURE_KEYS = {
  ocr: 'STAFF_CAN_OCR',
  createOrder: 'STAFF_CAN_CREATE_ORDER',
  reportSpec: 'STAFF_CAN_REPORT_SPEC',
  approve: 'STAFF_CAN_APPROVE',
  printDocs: 'STAFF_CAN_PRINT_DOCS',
} as const
export type StaffFeatureKey = (typeof STAFF_FEATURE_KEYS)[keyof typeof STAFF_FEATURE_KEYS]

export const SETTINGS_SPEC: SettingSpec[] = [
  // ============================================================
  // ① 事業者プロフィール — オーナーが設置時に1回
  // ============================================================
  { key: 'FARM_NAME', label: '事業者名', section: 'issuer', layer: 'profile', secret: false, kind: 'text', placeholder: '小島農園' },
  { key: 'FARM_INVOICE_REG_NUM', label: '適格請求書発行事業者 登録番号', section: 'issuer', layer: 'profile', secret: false, kind: 'text', placeholder: 'T1234567890123', hint: 'インボイス制度の登録番号（T＋13桁）' },
  { key: 'FARM_ADDRESS', label: '住所', section: 'issuer', layer: 'profile', secret: false, kind: 'text' },
  { key: 'FARM_TEL', label: '電話番号', section: 'issuer', layer: 'profile', secret: false, kind: 'text' },
  { key: 'FARM_PAYMENT_INFO', label: '振込先', section: 'issuer', layer: 'profile', secret: false, kind: 'textarea', hint: '請求書に印字する振込先口座' },
  {
    key: 'DELIVERY_NOTE_AMOUNT_MODE',
    label: '納品書の金額表示（既定）',
    section: 'issuer',
    layer: 'profile',
    secret: false,
    kind: 'select',
    options: DELIVERY_AMOUNT_MODES.map((m) => ({ value: m.value, label: m.label })),
    selectDefault: 'full',
    hint: '納品書発行時の初期値。発行ごとに切り替えもできます（金額あり／後から手書き／金額なし）',
  },

  // ============================================================
  // ② 運用チューニング — オーナーが運用しながら時々調整。危険な項目は danger:true
  // ============================================================
  // 規格（取引ルール）の変更管理
  {
    key: 'RULES_EDIT_LOCK',
    label: '規格の編集をロック（マスターのみ変更可）',
    section: 'rules',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    hint: 'ONにすると、下のマスターに指定した人だけが取引先の規格（P/C・荷姿・規格・端数等）を変更できます。それ以外は閲覧のみ。',
  },
  {
    key: 'RULES_MASTER_EMAILS',
    label: 'マスターのメール（規格を変更できる人）',
    section: 'rules',
    layer: 'operations',
    secret: false,
    kind: 'textarea',
    placeholder: 'naoki@example.com, master2@example.com',
    hint: 'カンマまたは改行区切り。空のままロックONにした場合は管理者全員が変更できます（総ロックアウト回避）。',
    dependsOn: { key: 'RULES_EDIT_LOCK', equals: 'on' },
  },
  {
    key: 'RULES_CHANGE_NOTIFY',
    label: '規格の追加・変更を通知する',
    section: 'rules',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'on',
    hint: '規格が変わったら Discord / LINE WORKS（通知設定の送信先）へ知らせます。変更履歴は常に保存され、取引先ページで参照できます。',
  },
  // 現場（スタッフ）機能の解放 — 既定はすべてOFF。出荷ステータス更新は常時可（トグル不要）。
  {
    key: 'STAFF_CAN_OCR',
    label: 'スタッフもOCR読み取りを使える',
    section: 'field',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    hint: 'ONにすると現場の「その他」からFAX/PDF/メールのAI読み取りが使えます（社内利用のみ。取引先には公開されません）。',
  },
  {
    key: 'STAFF_CAN_CREATE_ORDER',
    label: 'スタッフも注文を新規入力できる',
    section: 'field',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    hint: 'ONにすると現場から手動の注文入力ができます。',
  },
  {
    key: 'STAFF_CAN_REPORT_SPEC',
    label: 'スタッフが規格の変更を「報告」できる',
    section: 'field',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    hint: '現場が「箱・規格が変わったかも」を写真＋メモで報告できます。反映は管理者が確認してから（直接編集はできません）。',
  },
  {
    key: 'STAFF_CAN_APPROVE',
    label: 'スタッフも承認できる（高確信のみ）',
    section: 'field',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    danger: true,
    hint: '取引先が自動一致・全明細が高確信・納品日確定の受信だけスタッフが承認できます。低確信・未紐付け・差分は管理者専用のまま。家族など信頼できる人が居る時だけONを推奨。',
  },
  {
    key: 'STAFF_CAN_PRINT_DOCS',
    label: 'スタッフが出荷帳票を印刷できる',
    section: 'field',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    hint: 'ONにすると現場の「その他」から出荷表カード・出荷ラベルのPDF印刷が使えます。供給先は「取引先＞納入先」表記（例: ヨーク 東道野辺）。',
  },
  // AI解析（モデル選択・数量入力の既定単位。プロンプトは④へ）
  {
    key: 'GEMINI_MODEL',
    label: 'AIモデル',
    section: 'ai',
    layer: 'operations',
    secret: false,
    kind: 'select',
    options: GEMINI_MODEL_OPTIONS,
    selectDefault: '',
    hint: '受注OCR・写真からの一括取込で使うモデル。「自動」は新しいモデルから順に試し、混雑時は自動で切替えます。特定モデルに固定したい時だけ選んでください。',
  },
  // 数量入力モード（ケース入力⇔総数自動換算）
  {
    key: 'QTY_INPUT_MODE',
    label: '数量の入力単位（既定）',
    section: 'ai',
    layer: 'operations',
    secret: false,
    kind: 'select',
    options: [
      { value: 'total', label: '総数（個・本・枚 etc.）← 推奨' },
      { value: 'cases', label: 'ケース数（P/C で総数に自動換算）' },
    ],
    selectDefault: 'total',
    hint: '「ケース数」にすると、入力したケース数 × P/C = 総数 を自動計算します。総数で入力済みのデータには影響しません。注文入力画面で個別に切替も可。',
  },
  {
    key: 'ORDER_ANOMALY_THRESHOLD',
    label: '数量異常値の倍率しきい値',
    section: 'ai',
    layer: 'operations',
    secret: false,
    kind: 'text',
    placeholder: '2.5',
    hint: '注文入力時、過去90日の最大値 × この倍率を超えると警告を表示します（デフォルト: 2.5）。保存は通過します。',
  },
  // 自動承認（既定OFF。安全のため確信度＋取引先一致＋納品日確定＋品目一致を全部満たした時だけ自動）
  {
    key: 'AUTO_APPROVE_ENABLED',
    label: '自動承認を有効にする',
    section: 'automation',
    layer: 'operations',
    secret: false,
    kind: 'toggle',
    toggleDefault: 'off',
    danger: true,
    hint: 'ONでも下の確信度しきい値・取引先一致・納品日確定・品目一致を満たした受信のみ自動承認します',
  },
  {
    key: 'AUTO_APPROVE_THRESHOLD',
    label: '自動承認の確信度しきい値（0〜1）',
    section: 'automation',
    layer: 'operations',
    secret: false,
    kind: 'text',
    placeholder: '1.0',
    danger: true,
    hint: '1.0＝識字率100%のみ。0.95 等に下げると自動範囲が広がります（リスク増）',
    dependsOn: { key: 'AUTO_APPROVE_ENABLED', equals: 'on' },
  },
  // 通知ON/OFF（Webhook URL 本体は③接続・インフラ）
  { key: 'NOTIFY_DISCORD', label: 'Discord通知', section: 'notify', layer: 'operations', secret: false, kind: 'toggle', hint: 'on / off' },
  { key: 'NOTIFY_LINE_WORKS', label: 'LINE WORKS通知', section: 'notify', layer: 'operations', secret: false, kind: 'toggle', hint: 'on / off' },

  // ============================================================
  // ③ 接続・インフラ — 構築者が一度きり接続する秘密情報。既定は折りたたみ表示
  // ============================================================
  { key: 'GEMINI_API_KEY', label: 'Gemini APIキー', section: 'ai', layer: 'infra', secret: true, kind: 'text', hint: 'Google AI Studio で取得' },
  { key: 'DRIVE_FOLDER_ID', label: 'Drive フォルダID', section: 'ingest', layer: 'infra', secret: false, kind: 'text', hint: 'FAX画像が入る Google Drive フォルダのID' },
  { key: 'GOOGLE_SERVICE_ACCOUNT_JSON', label: 'Drive サービスアカウント鍵(JSON)', section: 'ingest', layer: 'infra', secret: true, kind: 'textarea', hint: 'Drive API 用サービスアカウントの鍵JSON全文' },
  { key: 'FAX_FILENAME_PATTERN', label: 'FAXファイル名規則', section: 'ingest', layer: 'infra', secret: false, kind: 'text', placeholder: '(?<fax>\\d{6,11})[_-](?<date>\\d{8})' },
  { key: 'IMAP_HOST', label: 'メールサーバー名（受信／IMAP）', section: 'ingest', layer: 'infra', secret: false, kind: 'text', placeholder: 'imap.example.com', hint: 'FAXソフトが注文を送る先のメールボックスの「受信サーバー名」。メール会社からもらった値を入れます。' },
  { key: 'IMAP_USER', label: 'メールのユーザー名（ログインID）', section: 'ingest', layer: 'infra', secret: false, kind: 'text', placeholder: 'order@kojima-farm.jp', hint: 'そのメールボックスにログインするID。FAXソフト側の転送先アドレスと同じ箱を指します。' },
  { key: 'IMAP_PASSWORD', label: 'メールのパスワード', section: 'ingest', layer: 'infra', secret: true, kind: 'text', hint: 'そのメールボックスのパスワード。' },
  { key: 'ORDER_KEYWORDS', label: '注文とみなすキーワード', section: 'ingest', layer: 'infra', secret: false, kind: 'text', placeholder: '注文,発注,ご注文,オーダー', hint: '件名・本文にこれらの語が含まれるメールを注文として取り込みます。カンマ区切り。FAXソフトからの転送メールは添付PDFがあるため、この語が無くても取り込まれます。' },
  { key: 'R2_ENDPOINT', label: 'R2 エンドポイント', section: 'storage', layer: 'infra', secret: false, kind: 'text', placeholder: 'https://xxxx.r2.cloudflarestorage.com' },
  { key: 'R2_BUCKET', label: 'R2 バケット', section: 'storage', layer: 'infra', secret: false, kind: 'text', placeholder: 'kojima-noen' },
  { key: 'R2_ACCESS_KEY_ID', label: 'R2 アクセスキーID', section: 'storage', layer: 'infra', secret: true, kind: 'text' },
  { key: 'R2_SECRET_ACCESS_KEY', label: 'R2 シークレットキー', section: 'storage', layer: 'infra', secret: true, kind: 'text' },
  { key: 'DISCORD_WEBHOOK_URL', label: 'Discord Webhook URL', section: 'notify', layer: 'infra', secret: true, kind: 'text' },
  { key: 'LINE_WORKS_WEBHOOK_URL', label: 'LINE WORKS Webhook URL', section: 'notify', layer: 'infra', secret: true, kind: 'text' },
  // チャット連携（統合2E-2 Discordボット・後続2E-3 LINE WORKSボット）。上の「通知（Webhook）」とは別物。
  {
    key: 'DISCORD_PUBLIC_KEY',
    label: 'Discord Public Key',
    section: 'chat',
    layer: 'infra',
    secret: true,
    kind: 'text',
    hint: 'Discord Developer Portal の Public Key（Interactions の署名検証に使用。hex文字列）',
  },
  {
    key: 'DISCORD_BOT_TOKEN',
    label: 'Discord Bot Token',
    section: 'chat',
    layer: 'infra',
    secret: true,
    kind: 'text',
    hint: 'ボタン付きメッセージをチャネルへ能動送信するための Bot Token。',
  },
  {
    key: 'DISCORD_CHANNEL_ID',
    label: 'Discord 通知先チャンネルID',
    section: 'chat',
    layer: 'infra',
    secret: false,
    kind: 'text',
    hint: '承認ボタン付きメッセージを能動送信する先のチャンネルID。',
  },
  {
    key: 'ALLOWED_DISCORD_USERS',
    label: '操作を許可する Discord ユーザーID',
    section: 'chat',
    layer: 'infra',
    secret: false,
    kind: 'text',
    placeholder: '123456789012345678,234567890123456789',
    hint: 'カンマ区切りのDiscordユーザーID。空欄の場合は全員に操作（承認等）を許可します。',
  },
  {
    key: 'CHAT_BOT_ACTOR_USER_ID',
    label: 'チャット承認の実行者ユーザー',
    section: 'chat',
    layer: 'infra',
    secret: false,
    kind: 'text',
    placeholder: 'users.id（UUID）',
    hint: 'Discord/LINE WORKSからの承認操作を、このアプリ内ユーザーとして実行します。未設定時は先頭の管理者ユーザーを使用。',
  },
  {
    key: 'LINE_WORKS_BOT_ID',
    label: 'LINE WORKS Bot ID',
    section: 'chat',
    layer: 'infra',
    secret: false,
    kind: 'text',
    status: 'planned',
    hint: '統合2E-3（LINE WORKSボット）用。現時点では枠のみ。',
  },
  {
    key: 'LINE_WORKS_API_TOKEN',
    label: 'LINE WORKS APIトークン',
    section: 'chat',
    layer: 'infra',
    secret: true,
    kind: 'text',
    status: 'planned',
    hint: '統合2E-3（LINE WORKSボット）用。現時点では枠のみ。',
  },
  {
    key: 'ALLOWED_LINE_USERS',
    label: '操作を許可する LINE WORKS ユーザーID',
    section: 'chat',
    layer: 'infra',
    secret: false,
    kind: 'text',
    status: 'planned',
    hint: 'カンマ区切り。統合2E-3（LINE WORKSボット）用。現時点では枠のみ。',
  },
  { key: 'CRON_SECRET', label: 'cron 共有シークレット', section: 'ops', layer: 'infra', secret: true, kind: 'text', hint: 'Cloud Scheduler からの取り込み呼び出しを検証' },
  { key: 'PDF_FONT_URL', label: 'PDF 日本語フォントURL', section: 'ops', layer: 'infra', secret: false, kind: 'text', hint: '空なら Noto Sans JP を既定使用。社内フォント等に差し替え可（otf/ttf）' },

  // ============================================================
  // ④ 移行・メンテナンス — 期間限定・上級者専用。既定は折りたたみ表示
  // ============================================================
  {
    key: 'GEMINI_PROMPT_NORMAL',
    label: '解析プロンプト（通常モード — FAX・メール）',
    section: 'ai',
    layer: 'migration',
    secret: false,
    kind: 'prompt',
    danger: true,
    defaultPrompt: DEFAULT_GEMINI_PROMPT_NORMAL,
    hint: 'FAX/メールの画像・テキストから注文明細を抽出する際の指示。変更すると解析結果が変わります。',
  },
  {
    key: 'GEMINI_PROMPT_DIFF',
    label: '解析プロンプト（差分モード — 再送検知）',
    section: 'ai',
    layer: 'migration',
    secret: false,
    kind: 'prompt',
    danger: true,
    defaultPrompt: DEFAULT_GEMINI_PROMPT_DIFF,
    hint: '「同じFAXに追記して再送」された場合の差分抽出指示。通常モードプロンプトに追記されます。',
  },
  // 影実行（統合2C）: v4本番との日次突合。URL/キーが空なら影実行は動かない（設定でON/OFF）
  { key: 'V4_SUPABASE_URL', label: '影実行: v4 Supabase URL', section: 'ops', layer: 'migration', secret: false, kind: 'text', placeholder: 'https://xxxx.supabase.co', hint: '統合2Cの並行運用期間のみ使用。空欄で影実行OFF' },
  { key: 'V4_SUPABASE_SERVICE_KEY', label: '影実行: v4 service_roleキー', section: 'ops', layer: 'migration', secret: true, kind: 'text', hint: 'v4本番の確定注文を読み取り比較する（読み取りのみに使用）' },
  { key: 'SHADOW_DIFF_CUSTOMER', label: '影実行: 対象取引先名', section: 'ops', layer: 'migration', secret: false, kind: 'text', placeholder: 'ヨーク', hint: '空欄なら「ヨーク」。v4がカバーする取引先だけを比較する' },
  { key: 'INTEGRATION_CUTOVER_DATE', label: '統合切替日（記録用）', section: 'ops', layer: 'migration', secret: false, kind: 'text', placeholder: '2026-07-20', hint: 'v4からの現場切替日（docs/cutover-2d.md）。この日以降は本アプリのデータが正' },
]

export const SETTINGS_BY_KEY: Record<string, SettingSpec> = Object.fromEntries(
  SETTINGS_SPEC.map((s) => [s.key, s]),
)

export const SECRET_KEYS = new Set(SETTINGS_SPEC.filter((s) => s.secret).map((s) => s.key))
