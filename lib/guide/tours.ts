/**
 * 現場向け操作ガイド（ツアー）の宣言的定義（Issue#9）。
 * 画面側は data-guide="..." 属性を対象要素に付けるだけで、ツアーの追加・変更は
 * このファイルだけで完結する（挙動には一切触れない）。
 */
export interface GuideStep {
  /** 対象要素の data-guide 値（document.querySelector('[data-guide="..."]')で特定） */
  target: string
  title: string
  body: string
}

export interface GuideTour {
  /** localStorage キーに使う識別子（例: 'shipments'） */
  key: string
  /** 内容を変えたら上げる。上げると既読済みでも再度自動表示される */
  version: number
  steps: GuideStep[]
}

/** localStorage の既読キーを生成する純関数（単体テスト対象）。 */
export function guideStorageKey(tour: Pick<GuideTour, 'key' | 'version'>): string {
  return `guide:${tour.key}:v${tour.version}`
}

/** 出荷一覧（/field/shipments）の初回ツアー。 */
export const SHIPMENTS_TOUR: GuideTour = {
  key: 'shipments',
  version: 1,
  steps: [
    {
      target: 'advance',
      title: '▶ でどんどん進める',
      body: 'タップするたびに「未着手→梱包完了→出荷済み」と進みます。品目ごとに1個ずつでOKです。',
    },
    {
      target: 'undo-bar',
      title: '間違えても5秒以内なら戻せる',
      body: '進めた直後の5秒間だけ「元に戻す」ボタンが出ます。誤タップしても慌てなくて大丈夫です。',
    },
    {
      target: 'reset',
      title: '◀ は確認してから1段戻る',
      body: '長押しではなく、タップ→確認ダイアログで1段階だけ戻せます。出荷済みを戻すと出荷実績も取り消されるので注意してください。',
    },
    {
      target: 'shipped-fold',
      title: '出荷済みは下にまとまる',
      body: '出荷が終わった分はここに折りたたまれます。タップすれば表示・非表示を切り替えられます。',
    },
    {
      target: 'smart-add',
      title: '当日分はここから手入力できる',
      body: '「スマート追加」で取引先・品目・数量を入れると、その日の出荷一覧に追加されます。',
    },
  ],
}
