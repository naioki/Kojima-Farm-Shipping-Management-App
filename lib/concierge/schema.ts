import { z } from 'zod'
import {
  findBestMatchingCustomer,
  findBestMatchingDestination,
  parseRelativeDateFromText,
  parseQuantityFromNaturalText,
} from '@/lib/orders/natural-parser'
import { shiftDateStr } from '@/lib/dates'

export const conciergeActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_shipment'),
    title: z.string(),
    summary: z.string(),
    payload: z.object({
      customer_id: z.string().optional(),
      customer_name: z.string(),
      destination_id: z.string().nullable().optional(),
      destination_name: z.string().nullable().optional(),
      product_id: z.string().optional(),
      product_name: z.string(),
      delivery_date: z.string(),
      quantity_raw: z.string(),
      packs_per_case: z.number().optional(),
      container_type: z.string().nullable().optional(),
      spec: z.string().nullable().optional(),
      has_card: z.boolean().nullable().optional(),
      has_seal: z.boolean().nullable().optional(),
      seal_text: z.string().nullable().optional(),
      bag_type: z.string().nullable().optional(),
      mode: z.enum(['create', 'increase', 'decrease', 'set']).default('create'),
      note: z.string().nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal('create_product'),
    title: z.string(),
    summary: z.string(),
    payload: z.object({
      name: z.string(),
      category: z.string().default('葉物'),
      base_unit: z.string().default('パック'),
      container_capacity: z.number().default(20),
      default_tax_rate: z.union([z.literal(8), z.literal(10)]).default(8),
    }),
  }),
  z.object({
    type: z.literal('create_customer'),
    title: z.string(),
    summary: z.string(),
    payload: z.object({
      name: z.string(),
      destination_name: z.string().nullable().optional(),
      packs_per_case: z.number().default(20),
      container_type: z.string().default('青コン'),
      aliases: z.array(z.string()).optional(),
      product_id: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('update_customer_rule'),
    title: z.string(),
    summary: z.string(),
    payload: z.object({
      customer_id: z.string().optional(),
      customer_name: z.string(),
      product_id: z.string().optional(),
      product_name: z.string().optional(),
      packs_per_case: z.number().nullable().optional(),
      container_type: z.string().nullable().optional(),
      spec: z.string().nullable().optional(),
      has_card: z.boolean().nullable().optional(),
      has_seal: z.boolean().nullable().optional(),
      seal_text: z.string().nullable().optional(),
      bag_type: z.string().nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal('update_departure_time'),
    title: z.string(),
    summary: z.string(),
    payload: z.object({
      customer_id: z.string().optional(),
      customer_name: z.string(),
      destination_id: z.string().nullable().optional(),
      destination_name: z.string().nullable().optional(),
      departure_time: z.string(),
      shipping_route_name: z.string().nullable().optional(),
      delivery_date: z.string().optional(),
      scope: z.enum(['master', 'date_only']).default('master'),
    }),
  }),
  z.object({
    type: z.literal('toggle_setting'),
    title: z.string(),
    summary: z.string(),
    payload: z.object({
      entries: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          value: z.string(),
        }),
      ),
    }),
  }),
  z.object({
    type: z.literal('navigate'),
    title: z.string(),
    summary: z.string(),
    payload: z.object({
      href: z.string(),
      button_label: z.string(),
    }),
  }),
])

export type ConciergeAction = z.infer<typeof conciergeActionSchema>

export interface ConciergeResponse {
  reply: string
  proposals: ConciergeAction[]
  followUpSuggestions: string[]
}

export interface ConciergeContextData {
  todayStr: string
  tomorrowStr: string
  customers: Array<{ id: string; name: string; aliases?: string[] }>
  destinations: Array<{ id: string; customer_id: string; code: string | null; full_name: string }>
  products: Array<{ id: string; name: string; unit: string; category?: string | null; container_capacity?: number | null }>
  currentSettings: Record<string, string>
  tomorrowOrderSummary: Array<{
    customerName: string
    destinationName: string
    productName: string
    quantity: number
    packsPerCase: number
  }>
}

/**
 * 小島農園アプリの「全機能・現場ルール・やさしい応答原則」を内蔵したコンシェルジュ専用プロンプト
 */
export function buildConciergeSystemPrompt(ctx: ConciergeContextData): string {
  const customerListText = ctx.customers
    .map((c) => `・${c.name}${c.aliases?.length ? `（別名:${c.aliases.join(',')}）` : ''} [ID:${c.id}]`)
    .join('\n')

  const productListText = ctx.products
    .map((p) => `・${p.name}（単位:${p.unit}, 標準入数:${p.container_capacity ?? 20}）[ID:${p.id}]`)
    .join('\n')

  const destListText = ctx.destinations
    .slice(0, 60)
    .map((d) => `・${d.code || d.full_name}（正式:${d.full_name}, 顧客ID:${d.customer_id}）[ID:${d.id}]`)
    .join('\n')

  const tomorrowSummaryText =
    ctx.tomorrowOrderSummary.length > 0
      ? ctx.tomorrowOrderSummary
          .map(
            (o) =>
              `・${o.customerName}${o.destinationName && o.destinationName !== o.customerName ? ` ▶ ${o.destinationName}` : ''}: ${o.productName} ${Math.ceil(o.quantity / o.packsPerCase)}箱（${o.quantity}P / ${o.packsPerCase}入）`,
          )
          .join('\n')
      : '（現在、明日納品分の登録済み注文はありません）'

  return `あなたは「小島農園 かんたんAI総合相談窓口（おまかせコンシェルジュ）」です。
パソコンやスマホの操作・細かな設定が苦手なスタッフや経営者の方のために、**専門用語を一切使わず、親しみやすく、短くわかりやすい日本語**で案内し、面倒な注文追加・品目追加・取引先登録・ルール変更・システム設定のON/OFFをすべて代わりに準備します。

==================================================
【1. 小島農園アプリの仕組み・現場ルール（あなたの知識）】
==================================================
1. **前日収穫・前日パックの鉄則**:
   - 小島農園では、すべての野菜を「出荷日（納品日）の前日」に収穫して袋詰め（パック）します。
   - そのため、「今日パック作業する分」＝「明日納品分（${ctx.tomorrowStr}）」です。
   - お客様が「明日の注文」「今日作業する分」と言ったら、納品日は原則として **明日（${ctx.tomorrowStr}）** です。
2. **主な画面の役割**:
   - **収穫・パックボード（/field/shipments）**: 今日パックする野菜の目標箱数・残り箱数と、出荷先ごとのカード一覧。上部コックピットの箱数は一律「総パック数 ÷ 20」で計算されます。
   - **便別積込・配送リスト（/field/deliveries）**: トラックへの積み込みチェック画面。早い便（16:00 NSK便 → 18:00 和郷園便 → 翌午前 農業総研便）の順に並びます。
   - **週の管理・週間表（/field/matrix）**: 1週間分の出荷予定を箱数またはパック数で一覧・直接入力できる表。
   - **帳票・ラベル印刷（/field/print）**: 現場の出荷指示書やコンテナラベルの印刷画面。
   - **受信ボックス・AI承認（/admin/inbox, /admin/approvals）**: FAXやメールで届いた注文書をAIが読み取り、確認・承認する画面。
   - **納品書・単価確定・請求書（/admin/delivery-notes, /admin/pricing, /admin/invoices）**: 出荷後の納品書発行、市場単価の入力、月末の請求書作成画面。
3. **取引先ごとの基本ルール（暗黙の了解）**:
   - 標準入数は **1箱20パック（20入）**。
   - **農業総合研究所（NSK）**: 1箱 **24入**、容器は「農業総研専用折りたたみコンテナ（NSKオリコン）」、北海道向け以外は「200gUP」。
   - **オレンジファーム**: 1箱 **25入**（注文書の数字はすべてコンテナ数＝箱数。例: 50＝50箱＝1,250パック）。集荷は原則【水曜・金曜朝一番】のため、木曜着分→水曜出荷、土曜着分→金曜出荷で管理。容器は「青コン」。
   - **ランドローム（やなぎさわファーム）**: 1箱 **10入**、容器は「青コン」。
   - **和郷園**: 1箱 **20入**、生産者カードあり。
   - **勘兵衛**: 1箱 **20入**、生産者カードあり。
   - **房総食料センター**: 1箱 **20入**、容器は「房総青コン」、生産者カードあり。
4. **変更できるアプリ設定（toggle_setting）**:
   - \`STAFF_CAN_OCR\`: 現場スタッフの写真・FAX自動読取を許可（"on" / "off"）
   - \`STAFF_CAN_CREATE_ORDER\`: 現場スタッフの注文追加・変更を許可（"on" / "off"）
   - \`STAFF_CAN_APPROVE\`: 現場スタッフの未確認注文の承認を許可（"on" / "off"）
   - \`STAFF_CAN_PRINT_DOCS\`: 現場スタッフの帳票・ラベル印刷を許可（"on" / "off"）
   - \`STAFF_CAN_REPORT_SPEC\`: 現場スタッフの規格変更・報告を許可（"on" / "off"）
   - \`AUTO_APPROVE_ENABLED\`: AI読取の自動確定（問題ない注文を自動で出荷ボードへ反映）（"on" / "off"）
   - \`NOTIFY_LINEWORKS_ENABLED\`: LINE WORKSへの通知（"on" / "off"）

==================================================
【2. 現在のマスタ・明日の注文状況（基準日: 今日=${ctx.todayStr} / 明日納品=${ctx.tomorrowStr}）】
==================================================
■ 登録済み品目:
${productListText}

■ 登録済み取引先:
${customerListText}

■ 主な納入先:
${destListText}

■ 明日納品（${ctx.tomorrowStr}・本日パック作業分）の現在の注文:
${tomorrowSummaryText}

■ 現在の主なシステム設定:
${Object.entries(ctx.currentSettings)
  .map(([k, v]) => `・${k}: ${v}`)
  .join('\n')}

==================================================
【3. 応答のルール（重要）】
==================================================
- 必ず以下のJSONフォーマットのみで出力してください（Markdownのコードブロックも不要です）。
- \`reply\` には、やさしい話し言葉（2〜4文程度）で回答を書いてください。「データベース」「レコード」「カラム」「パラメータ」などの難しいIT用語は絶対に使わないでください。
- ユーザーが「〜を追加して」「〜の設定をオンにして」「〜の入数を変えて」など、具体的な作業や設定変更を頼んだ場合は、\`proposals\` 配列に実行用のアクションを入れてください。画面に**「はい、この内容で実行する」ボタン**が表示されます。
- もし「スタッフの制限を全部解除して（スタッフに全部やらせてあげて）」と言われたら、\`STAFF_CAN_OCR\`, \`STAFF_CAN_CREATE_ORDER\`, \`STAFF_CAN_APPROVE\`, \`STAFF_CAN_PRINT_DOCS\`, \`STAFF_CAN_REPORT_SPEC\` をまとめて \`"on"\` にする \`toggle_setting\` アクションを1つ提案してください。
- 既存の取引先にない名前（未登録の取引先）の注文を頼まれた場合は、別会社に混ぜず、まず \`create_customer\` アクション（またはその取引先名での \`add_shipment\`）を提案してください。

出力JSONスキーマ:
{
  "reply": "わかりやすい丁寧な返答メッセージ",
  "proposals": [
    // 実行ボタンを出すアクション（0個〜複数個）
    // type は "add_shipment" | "create_product" | "create_customer" | "update_customer_rule" | "update_departure_time" | "toggle_setting" | "navigate" のいずれか
  ],
  "followUpSuggestions": [
    "次にタップするだけで聞けるおすすめの一言1",
    "おすすめの一言2"
  ]
}`
}

/**
 * Gemini API が万一タイムアウト・クォータ超過した場合や、定型の即時リクエストに対して
 * 0.01秒で応答・提案カードを生成する決定論的コンシェルジュ解決エンジン
 */
export function buildDeterministicConciergeResponse(
  rawMessage: string,
  ctx: ConciergeContextData,
): ConciergeResponse | null {
  const text = rawMessage.trim()
  const norm = text.normalize('NFKC')

  // 1. スタッフ権限・面倒な設定のON/OFF依頼
  if (/(スタッフ|現場).*(全部|すべて|制限|権限|できる|オン|ON)/i.test(norm) || /(めんどくさい設定|面倒な設定).*(オン|ON|おまかせ)/i.test(norm)) {
    return {
      reply:
        '現場スタッフの方が「写真の読み取り」「注文の追加・変更」「未確認注文の承認」「印刷」「規格変更」をすべて使えるように設定をオンにしますね！下の緑のボタンを押すだけで完了します。',
      proposals: [
        {
          type: 'toggle_setting',
          title: '現場スタッフの全機能を「オン（許可）」にする',
          summary: '写真読取・注文追加・承認・印刷・規格変更の5つのスイッチをすべてONにします。',
          payload: {
            entries: [
              { key: 'STAFF_CAN_OCR', label: '写真・FAXの自動読取', value: 'on' },
              { key: 'STAFF_CAN_CREATE_ORDER', label: '新規注文の追加・変更', value: 'on' },
              { key: 'STAFF_CAN_APPROVE', label: '未確認注文の承認', value: 'on' },
              { key: 'STAFF_CAN_PRINT_DOCS', label: '帳票・ラベル印刷', value: 'on' },
              { key: 'STAFF_CAN_REPORT_SPEC', label: '規格変更・報告', value: 'on' },
            ],
          },
        },
      ],
      followUpSuggestions: ['AIの自動確定もオンにして', '明日の注文状況を教えて', '新しい品目を追加したい'],
    }
  }

  if (/(自動確定|自動承認).*(オン|ON|有効)/i.test(norm)) {
    return {
      reply: 'AIが自信を持って読み取れた注文を、自動で出荷ボードに反映する「自動確定」をオンにしますね。下のボタンを押すと設定されます。',
      proposals: [
        {
          type: 'toggle_setting',
          title: 'AI読取の「自動確定」をオンにする',
          summary: '問題のないFAX・写真注文を、確認待ちにせず自動で出荷ボードへ反映します。',
          payload: {
            entries: [{ key: 'AUTO_APPROVE_ENABLED', label: '承認の自動確定', value: 'on' }],
          },
        },
      ],
      followUpSuggestions: ['自動確定をオフに戻して', '明日の注文状況を教えて'],
    }
  }

  if (/(自動確定|自動承認).*(オフ|OFF|無効|止め)/i.test(norm)) {
    return {
      reply: 'AIの「自動確定」をオフにして、すべての注文を人間が確認してから反映するように戻しますね。',
      proposals: [
        {
          type: 'toggle_setting',
          title: 'AI読取の「自動確定」をオフにする',
          summary: 'FAX・写真注文をすべて「未確認注文の承認」画面でチェックしてから反映するようにします。',
          payload: {
            entries: [{ key: 'AUTO_APPROVE_ENABLED', label: '承認の自動確定', value: 'off' }],
          },
        },
      ],
      followUpSuggestions: ['未確認注文の承認画面を開く', '明日の注文状況を教えて'],
    }
  }

  // 2. 新しい品目（野菜）の追加依頼（例：「春菊を品目に追加して」「明日の品目でラディッシュを追加」）
  const prodAddMatch = norm.match(/(?:新し[いく]?品目|品目|野菜|商品)(?:で|に|として|の)?\s*[「『]?([^\s「」『』、。にをが]{2,15})[」』]?\s*(?:を|も)?(?:追加|登録|作|入れ)/) ||
    norm.match(/[「『]([^\s「」『』、。]{2,15})[」』]\s*を?(?:品目|野菜|商品)?(?:に|として)?(?:追加|登録)/)
  if (prodAddMatch?.[1]) {
    const candidateName = prodAddMatch[1].replace(/^(明日|今日|明後日)の?/, '').trim()
    const existingProd = ctx.products.find((p) => p.name === candidateName)
    if (candidateName && !existingProd) {
      return {
        reply: `新しい品目「${candidateName}」（標準1箱20パック・軽減税率8%）を追加する準備ができました！下のボタンを押すとすぐに使えるようになります。`,
        proposals: [
          {
            type: 'create_product',
            title: `新しい品目「${candidateName}」を登録する`,
            summary: `品目名: ${candidateName} ／ 単位: パック ／ 標準入数: 20入 ／ 税率: 8%`,
            payload: {
              name: candidateName,
              category: '葉物',
              base_unit: 'パック',
              container_capacity: 20,
              default_tax_rate: 8,
            },
          },
        ],
        followUpSuggestions: [`明日 和郷園に${candidateName} 10箱追加して`, '収穫・パックボードを開く'],
      }
    }
  }

  // 3. 入数・容器・シール・カード等のルール変更依頼（例：「オレンジファームの入数を20入りに変えて」）
  const rulePpcMatch = norm.match(/(.+?)(?:の|を).*?(?:1箱|入数)?\s*(\d{2})\s*(?:入|パック|P)(?:り)?.*?(?:変|設定|にして|登録)/i)
  if (rulePpcMatch && !/(箱|ケース|c)\s*(?:追加|注文|増)/i.test(norm)) {
    const custHint = rulePpcMatch[1]!.replace(/^(取引先|顧客)\s*/, '').trim()
    const newPpc = Number(rulePpcMatch[2])
    const matchedCust = findBestMatchingCustomer(custHint, ctx.customers)
    if (matchedCust && newPpc >= 10 && newPpc <= 100) {
      const targetProd = ctx.products[0]
      return {
        reply: `「${matchedCust.name}」の1箱あたりの入数を「${newPpc}入」に変更しますね。下のボタンを押すと、今後の注文から自動で${newPpc}入りで箱数が計算されます！`,
        proposals: [
          {
            type: 'update_customer_rule',
            title: `${matchedCust.name} の入数を「${newPpc}入」に変更する`,
            summary: `対象: ${matchedCust.name}（${targetProd?.name ?? '全品目'}） ／ 1箱の入数: ${newPpc}パック`,
            payload: {
              customer_id: matchedCust.id,
              customer_name: matchedCust.name,
              product_id: targetProd?.id,
              product_name: targetProd?.name,
              packs_per_case: newPpc,
            },
          },
        ],
        followUpSuggestions: ['収穫・パックボードを開く', '明日の注文状況を教えて'],
      }
    }
  }

  // 4. 明日の注文状況の確認
  if (/(明日|本日作業|今日).*(注文|出荷|予定|状況|何箱|いくつ).*(教えて|見せて|確認|は[？?])/i.test(norm)) {
    const totalPacks = ctx.tomorrowOrderSummary.reduce((a, b) => a + b.quantity, 0)
    const totalBoxes = totalPacks > 0 ? Math.ceil(totalPacks / 20) : 0
    const lines = ctx.tomorrowOrderSummary
      .map(
        (o) =>
          `・${o.customerName}${o.destinationName && o.destinationName !== o.customerName ? ` ▶ ${o.destinationName}` : ''}: ${Math.ceil(o.quantity / o.packsPerCase)}箱（${o.quantity}P）`,
      )
      .join('\n')
    return {
      reply:
        ctx.tomorrowOrderSummary.length > 0
          ? `明日納品（${ctx.tomorrowStr}・本日パック作業分）の注文は、現在 **${ctx.tomorrowOrderSummary.length}件・合計 ${totalBoxes}箱（${totalPacks.toLocaleString()}パック）** です！\n\n${lines}`
          : `明日納品（${ctx.tomorrowStr}）の注文はまだ登録されていません。「明日 和郷園に20箱追加して」のように話しかけていただければすぐ登録できます！`,
      proposals: [
        {
          type: 'navigate',
          title: '収穫・パックボードを開く',
          summary: `${ctx.tomorrowStr} 納品分の作業ボードへ移動します`,
          payload: {
            href: `/field/shipments?date=${ctx.tomorrowStr}`,
            button_label: '📦 収穫・パックボードを見る',
          },
        },
      ],
      followUpSuggestions: ['明日 和郷園に青梗菜 20箱追加して', '便別積込・配送リストを見る'],
    }
  }

  // 5. 注文の追加・数量変更（例：「明日 和郷園に20箱追加して」「勘兵衛 5ケース」）
  const matchedCust = findBestMatchingCustomer(norm, ctx.customers)
  if (matchedCust && /(\d+)\s*(箱|ケース|c|C|パック|p|P)/i.test(norm)) {
    const dateInfo = parseRelativeDateFromText(norm, shiftDateStr(ctx.todayStr, 1))
    const matchedDest = findBestMatchingDestination(norm, ctx.destinations, matchedCust.id)
    const matchedProd =
      ctx.products.find((p) => norm.includes(p.name) || (norm.includes('チンゲン') && p.name.includes('青梗菜'))) ??
      ctx.products[0]
    const defaultPpc = matchedCust.name.includes('農業総合研究所') || matchedCust.name.includes('NSK')
      ? 24
      : matchedCust.name.includes('オレンジファーム')
      ? 25
      : matchedCust.name.includes('ランドローム') || matchedCust.name.includes('やなぎさわ')
      ? 10
      : matchedProd?.container_capacity ?? 20
    const qtyInfo = parseQuantityFromNaturalText(norm, defaultPpc)
    if (qtyInfo.totalPacks && qtyInfo.totalPacks > 0 && matchedProd) {
      const mode: 'create' | 'increase' | 'set' = /(増|プラス|追加で)/.test(norm)
        ? 'increase'
        : /(変更|直して|上書き)/.test(norm)
        ? 'set'
        : 'create'
      const qRaw = qtyInfo.isCaseInput && qtyInfo.cases ? `${qtyInfo.cases}c` : String(qtyInfo.totalPacks)
      const boxes = Math.ceil(qtyInfo.totalPacks / defaultPpc)
      const targetDate = dateInfo.deliveryDate || ctx.tomorrowStr
      return {
        reply: `${targetDate} 納品分で「${matchedCust.name}${matchedDest ? ` ▶ ${matchedDest.code || matchedDest.full_name}` : ''}」に「${matchedProd.name} ${boxes}箱（${qtyInfo.totalPacks}パック）」を登録する準備ができました！よろしければ下のボタンを押してください。`,
        proposals: [
          {
            type: 'add_shipment',
            title: `${matchedCust.name}${matchedDest ? `（${matchedDest.code || matchedDest.full_name}）` : ''} に ${boxes}箱（${qtyInfo.totalPacks}P）を登録`,
            summary: `納品日: ${targetDate} ／ 品目: ${matchedProd.name} ／ 数量: ${boxes}箱（${qtyInfo.totalPacks}P・${defaultPpc}入）`,
            payload: {
              customer_id: matchedCust.id,
              customer_name: matchedCust.name,
              destination_id: matchedDest?.id ?? null,
              destination_name: matchedDest ? matchedDest.code || matchedDest.full_name : null,
              product_id: matchedProd.id,
              product_name: matchedProd.name,
              delivery_date: targetDate,
              quantity_raw: qRaw,
              packs_per_case: defaultPpc,
              mode,
            },
          },
        ],
        followUpSuggestions: ['収穫・パックボードを開く', '明日の注文状況を教えて'],
      }
    }
  }

  return null
}
