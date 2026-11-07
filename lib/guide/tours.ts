/**
 * 現場向け操作ガイド（ツアー）の宣言的定義（Issue#9）。
 * 画面側は data-guide="..." 属性を対象要素に付けるだけで、ツアーの追加・変更は
 * このファイルだけで完結する（挙動には一切触れない）。
 *
 * - 文言はやさしい日本語＋タイ語（現場の言語切替がタイ語のときは *_th を表示）
 * - 内容を変えたら version を上げる（既読済みの端末にも1回だけ再表示される）
 * - target は tests/guide-targets.test.ts で「画面のソースに data-guide として存在するか」を静的検査している
 */
export interface GuideStep {
  /** 対象要素の data-guide 値（document.querySelector('[data-guide="..."]')で特定。複数あれば最初の1つ） */
  target: string
  title: string
  body: string
  /** タイ語（現場の言語切替が ไทย のとき表示） */
  title_th: string
  body_th: string
}

export interface GuideTour {
  /** localStorage キーに使う識別子（例: 'shipments'） */
  key: string
  /** 内容を変えたら上げる。上げると既読済みでも再度自動表示される */
  version: number
  steps: GuideStep[]
}

export type GuideLang = 'ja' | 'th'

/** localStorage の既読キーを生成する純関数（単体テスト対象）。 */
export function guideStorageKey(tour: Pick<GuideTour, 'key' | 'version'>): string {
  return `guide:${tour.key}:v${tour.version}`
}

/** 言語に応じたステップの見出し・本文を返す（タイ語が空なら日本語にフォールバック）。 */
export function localizeStep(step: GuideStep, lang: GuideLang): { title: string; body: string } {
  if (lang === 'th') {
    return { title: step.title_th || step.title, body: step.body_th || step.body }
  }
  return { title: step.title, body: step.body }
}

/** ツアーの吹き出し・「使い方」ボタンの文言（日本語／タイ語）。 */
export const GUIDE_UI_LABELS: Record<
  GuideLang,
  { next: string; back: string; done: string; close: string; dontShow: string; open: string }
> = {
  ja: {
    next: '次へ',
    back: 'もどる',
    done: 'おわり',
    close: 'とじる',
    dontShow: 'この端末では次から自動で出さない',
    open: '使い方',
  },
  th: {
    next: 'ถัดไป',
    back: 'ย้อนกลับ',
    done: 'เสร็จ',
    close: 'ปิด',
    dontShow: 'เครื่องนี้ไม่ต้องแสดงเองอีก',
    open: 'วิธีใช้',
  },
}

/** 収穫・パックボード（/field/shipments）の初回ツアー。 */
export const SHIPMENTS_TOUR: GuideTour = {
  key: 'shipments',
  version: 2,
  steps: [
    {
      target: 'date-nav',
      title: '日付をえらぶ',
      body: 'ここは納品する日です。◀ ▶ で1日ずつ動きます。',
      title_th: 'เลือกวันที่',
      body_th: 'นี่คือวันส่งของ กด ◀ ▶ เพื่อเลื่อนทีละวัน',
    },
    {
      target: 'product-tabs',
      title: '品目をえらぶ',
      body: '作業する野菜のボタンを押します。オレンジの数字は、まだ終わっていない数です。',
      title_th: 'เลือกผัก',
      body_th: 'กดปุ่มผักที่จะทำ ตัวเลขสีส้มคือจำนวนที่ยังไม่เสร็จ',
    },
    {
      target: 'pack-progress',
      title: '残りの箱数',
      body: '「あと○箱」が、残りの箱の数です。',
      title_th: 'ลังที่เหลือ',
      body_th: '"あと○箱" คือจำนวนลังที่ยังเหลือ',
    },
    {
      target: 'pack-actions',
      title: 'できたら「パック済にする」',
      body: '全部できたら「パック済にする」を押します。途中なら「詳細・途中数」で数を入れます。',
      title_th: 'เสร็จแล้วกด "パック済にする"',
      body_th: 'แพ็คครบแล้วกด "パック済にする" ถ้ายังไม่ครบ กด "詳細・途中数" แล้วใส่จำนวน',
    },
    {
      target: 'pack-revert',
      title: 'まちがえたら「戻す」',
      body: '終わったカードの「戻す」で、元にもどせます。',
      title_th: 'กดผิด กด "戻す"',
      body_th: 'กด "戻す" ที่การ์ดที่เสร็จแล้ว เพื่อย้อนกลับ',
    },
    {
      target: 'add-order',
      title: '注文を追加する',
      body: '電話などで来た注文は、ここから追加します。',
      title_th: 'เพิ่มออร์เดอร์',
      body_th: 'ออร์เดอร์ที่มาทางโทรศัพท์ เพิ่มได้จากตรงนี้',
    },
  ],
}

/** 積込・配送リスト（/field/deliveries）の初回ツアー。 */
export const DELIVERIES_TOUR: GuideTour = {
  key: 'deliveries',
  version: 1,
  steps: [
    {
      target: 'date-nav',
      title: '日付をえらぶ',
      body: 'ここは納品する日です。◀ ▶ で1日ずつ動きます。',
      title_th: 'เลือกวันที่',
      body_th: 'นี่คือวันส่งของ กด ◀ ▶ เพื่อเลื่อนทีละวัน',
    },
    {
      target: 'preflight',
      title: '積込前チェック',
      body: 'パックが終わっていない野菜が、ここに出ます。積む前に見てください。',
      title_th: 'ตรวจก่อนขึ้นรถ',
      body_th: 'ผักที่ยังแพ็คไม่เสร็จจะแสดงตรงนี้ ดูก่อนขึ้นรถ',
    },
    {
      target: 'load-progress',
      title: '積んだ箱の数',
      body: '「残○箱」が、まだ積んでいない箱の数です。',
      title_th: 'ลังที่ขึ้นรถแล้ว',
      body_th: '"残○箱" คือจำนวนลังที่ยังไม่ขึ้นรถ',
    },
    {
      target: 'delivery-route-group',
      title: '便ごとのカード',
      body: '出発の早い便から順に並んでいます。',
      title_th: 'การ์ดตามรอบรถ',
      body_th: 'เรียงจากรอบรถที่ออกก่อน',
    },
    {
      target: 'load-ok',
      title: '積んだら「積込 OK」',
      body: '車に積んだら押します。もう一度押すと元にもどります。',
      title_th: 'ขึ้นรถแล้วกด "積込 OK"',
      body_th: 'ขึ้นรถแล้วให้กด กดอีกครั้งเพื่อยกเลิก',
    },
    {
      target: 'delivery-note-pdf',
      title: '納品書を出す',
      body: '運転手さんにわたす納品書は、ここから印刷します。',
      title_th: 'พิมพ์ใบส่งของ',
      body_th: 'ใบส่งของให้คนขับ พิมพ์จากตรงนี้',
    },
  ],
}

/** 週の管理（/field/matrix）の初回ツアー。 */
export const MATRIX_TOUR: GuideTour = {
  key: 'matrix',
  version: 1,
  steps: [
    {
      target: 'week-nav',
      title: '週をえらぶ',
      body: '「前週」「翌週」で1週間ずつ動きます。',
      title_th: 'เลือกสัปดาห์',
      body_th: 'กด "前週" หรือ "翌週" เพื่อเลื่อนทีละสัปดาห์',
    },
    {
      target: 'matrix-products',
      title: '品目をえらぶ',
      body: '見たい野菜のボタンを押します。',
      title_th: 'เลือกผัก',
      body_th: 'กดปุ่มผักที่อยากดู',
    },
    {
      target: 'matrix-unit',
      title: '箱かパックか',
      body: '「箱」なら数字は箱の数です。「パック」ならパックの数です。',
      title_th: 'ลังหรือถุง',
      body_th: 'โหมด "箱" ตัวเลขคือจำนวนลัง โหมด "パック" คือจำนวนถุง',
    },
    {
      target: 'matrix-date-head',
      title: '日付を押す',
      body: 'その日の収穫・パックボードが開きます。',
      title_th: 'กดวันที่',
      body_th: 'จะเปิดหน้าเก็บเกี่ยวและแพ็คของวันนั้น',
    },
    {
      target: 'matrix-cell',
      title: 'マスに数を入れる',
      body: 'マスを押して数字を入れます。自動で保存されます。',
      title_th: 'ใส่ตัวเลขในช่อง',
      body_th: 'กดที่ช่องแล้วใส่ตัวเลข ระบบจะบันทึกเอง',
    },
    {
      target: 'matrix-breakdown',
      title: '内訳を開く',
      body: '「内訳」を押すと、納入先ごとに数を入れられます。',
      title_th: 'เปิดรายละเอียด',
      body_th: 'กด "内訳" เพื่อใส่จำนวนแยกตามที่ส่ง',
    },
  ],
}

/** 全ツアー（テストで target の存在を一括検査する）。 */
export const ALL_TOURS: GuideTour[] = [SHIPMENTS_TOUR, DELIVERIES_TOUR, MATRIX_TOUR]
