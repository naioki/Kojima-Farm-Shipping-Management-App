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

/** ツアーの吹き出し・「？」ボタンの文言（日本語／タイ語）。 */
export const GUIDE_UI_LABELS: Record<
  GuideLang,
  { next: string; back: string; done: string; close: string; dontShow: string; open: string }
> = {
  ja: {
    next: '次へ',
    back: '戻る',
    done: '完了',
    close: '閉じる',
    dontShow: 'もう表示しない',
    open: '使い方ガイド',
  },
  th: {
    next: 'ถัดไป',
    back: 'ย้อนกลับ',
    done: 'เสร็จสิ้น',
    close: 'ปิด',
    dontShow: 'ไม่ต้องแสดงอีก',
    open: 'วิธีใช้งาน',
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
      body: 'ここに出ているのは納品日です。◀ ▶ で1日ずつ動きます。まん中を押すとカレンダーから選べます。',
      title_th: 'เลือกวันที่',
      body_th: 'วันที่ตรงนี้คือวันส่งของ กด ◀ ▶ เพื่อเลื่อนทีละวัน กดตรงกลางเพื่อเลือกจากปฏิทิน',
    },
    {
      target: 'product-tabs',
      title: '品目をえらぶ',
      body: '作業する品目を押します。「残1/3」は 3件のうち 1件がまだ、という意味です。',
      title_th: 'เลือกผัก',
      body_th: 'กดชื่อผักที่จะทำงาน "残1/3" หมายถึง ยังเหลือ 1 รายการ จากทั้งหมด 3 รายการ',
    },
    {
      target: 'pack-progress',
      title: '残りの箱数を見る',
      body: '大きい数字は「できた箱 / 目標の箱」です。下の「あと○箱」が残りです。',
      title_th: 'ดูจำนวนลังที่เหลือ',
      body_th: 'ตัวเลขใหญ่คือ "ลังที่เสร็จ / ลังเป้าหมาย" ส่วน "あと○箱" ด้านล่างคือจำนวนลังที่ยังเหลือ',
    },
    {
      target: 'route-group',
      title: '便ごとにまとまっている',
      body: '出発の早い便から順に並んでいます。右の「残り」でその便があと何箱か分かります。',
      title_th: 'แบ่งกลุ่มตามรอบรถ',
      body_th: 'เรียงจากรอบรถที่ออกก่อน ตัวเลข "残り" ทางขวาบอกว่ารอบนั้นยังเหลือกี่ลัง',
    },
    {
      target: 'pack-actions',
      title: 'パック済にする・途中数・戻す',
      body: '全部できたら「パック済にする」。途中までなら「詳細・途中数」で数を記録します。まちがえたら、終わったカードの「戻す」で元にもどせます。',
      title_th: 'แพ็คเสร็จ / บันทึกระหว่างทาง / ยกเลิก',
      body_th: 'แพ็คครบแล้วกด "パック済にする" ถ้ายังไม่ครบ กด "詳細・途中数" แล้วใส่จำนวน ถ้ากดผิด กด "戻す" ที่การ์ดที่เสร็จแล้วเพื่อย้อนกลับ',
    },
    {
      target: 'add-order',
      title: '注文を追加する',
      body: '電話などで来た注文は、ここから追加できます。写真やLINEの文を貼り付けてもOKです。',
      title_th: 'เพิ่มออร์เดอร์',
      body_th: 'ออร์เดอร์ที่มาทางโทรศัพท์ เพิ่มได้จากตรงนี้ จะแนบรูปหรือข้อความ LINE ก็ได้',
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
      body: 'ここに出ているのは納品日です。◀ ▶ で1日ずつ動きます。',
      title_th: 'เลือกวันที่',
      body_th: 'วันที่ตรงนี้คือวันส่งของ กด ◀ ▶ เพื่อเลื่อนทีละวัน',
    },
    {
      target: 'preflight',
      title: '積込前チェック',
      body: 'パックが終わっていない品目や、数が足りない品目がここに出ます。積む前に見てください。',
      title_th: 'ตรวจก่อนขึ้นรถ',
      body_th: 'ผักที่ยังแพ็คไม่เสร็จหรือจำนวนไม่ครบจะแสดงตรงนี้ ดูก่อนขึ้นรถทุกครั้ง',
    },
    {
      target: 'load-progress',
      title: '積んだ箱の数',
      body: '「積んだ箱 / 全部の箱」と、残りの箱数です。',
      title_th: 'จำนวนลังที่ขึ้นรถแล้ว',
      body_th: 'แสดง "ลังที่ขึ้นรถแล้ว / ลังทั้งหมด" และจำนวนลังที่ยังเหลือ',
    },
    {
      target: 'delivery-route-group',
      title: '便ごとのカード',
      body: '出発の早い便から順に、取引先ごとのカードが並びます。',
      title_th: 'การ์ดแยกตามรอบรถ',
      body_th: 'การ์ดของลูกค้าเรียงตามรอบรถที่ออกก่อน',
    },
    {
      target: 'load-ok',
      title: '積んだら「積込 OK」',
      body: '箱を車に積んだら押します。まちがえたら、もう一度押すと元にもどせます。',
      title_th: 'ขึ้นรถแล้วกด "積込 OK"',
      body_th: 'เอาลังขึ้นรถแล้วให้กด ถ้ากดผิด กดอีกครั้งเพื่อยกเลิก',
    },
    {
      target: 'delivery-note-pdf',
      title: '納品書を出す',
      body: '運転手さんにわたす納品書は「納品書PDF」から印刷できます。',
      title_th: 'พิมพ์ใบส่งของ',
      body_th: 'ใบส่งของสำหรับคนขับ พิมพ์ได้จาก "納品書PDF"',
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
      body: '「前週」「翌週」で1週間ずつ動きます。「今日〜1週間」で今週にもどります。',
      title_th: 'เลือกสัปดาห์',
      body_th: 'กด "前週" หรือ "翌週" เพื่อเลื่อนทีละสัปดาห์ กด "今日〜1週間" เพื่อกลับมาสัปดาห์นี้',
    },
    {
      target: 'matrix-products',
      title: '品目をえらぶ',
      body: '見たい品目を押すと、その品目の1週間の表になります。',
      title_th: 'เลือกผัก',
      body_th: 'กดชื่อผักเพื่อดูตารางของผักนั้นทั้งสัปดาห์',
    },
    {
      target: 'matrix-unit',
      title: '箱で入れるか、パックで入れるか',
      body: '「箱」のときは数字が箱数、「パック」のときはパック数になります。',
      title_th: 'ใส่เป็นลังหรือเป็นถุง',
      body_th: 'โหมด "箱" ตัวเลขคือจำนวนลัง โหมด "パック" ตัวเลขคือจำนวนถุง',
    },
    {
      target: 'matrix-date-head',
      title: '日付を押すとパックボードへ',
      body: '日付を押すと、その日の収穫・パックボードが開きます。',
      title_th: 'กดวันที่เพื่อไปหน้าแพ็ค',
      body_th: 'กดวันที่เพื่อเปิดหน้าเก็บเกี่ยว/แพ็คของวันนั้น',
    },
    {
      target: 'matrix-cell',
      title: 'マスに箱数を入れる',
      body: 'マスを押して数字を入れると、自動で保存されます。納入先が多い取引先は、押すと内訳が開きます。',
      title_th: 'ใส่จำนวนลังในช่อง',
      body_th: 'กดที่ช่องแล้วใส่ตัวเลข ระบบจะบันทึกเอง ลูกค้าที่มีหลายที่ส่ง กดแล้วจะเปิดรายละเอียด',
    },
    {
      target: 'matrix-breakdown',
      title: '内訳を開く',
      body: '「内訳」を押すと、納入先ごとの行が出ます。納入先ごとに数を入れられます。',
      title_th: 'เปิดรายละเอียด',
      body_th: 'กด "内訳" จะแสดงแถวแยกตามที่ส่ง ใส่จำนวนแยกแต่ละที่ได้',
    },
  ],
}

/** 全ツアー（テストで target の存在を一括検査する）。 */
export const ALL_TOURS: GuideTour[] = [SHIPMENTS_TOUR, DELIVERIES_TOUR, MATRIX_TOUR]
