/**
 * 「実際に操作していた時間」の積算（純関数）。
 * 画面が表示中で、かつ最後の操作（クリック・キー入力・スクロール・タップ）から
 * IDLE_MS 以内なら、その tick を「操作中」として加算する。開きっぱなしの放置時間は数えない。
 */
export const TICK_MS = 5_000
export const IDLE_MS = 60_000
/** 1イベントで受け付ける上限（異常値・時計ずれ対策） */
export const MAX_ACTIVE_MS_PER_EVENT = 30 * 60_000

export function shouldCountTick(params: { visible: boolean; now: number; lastInteractionAt: number }): boolean {
  return params.visible && params.now - params.lastInteractionAt <= IDLE_MS
}

/** 計測パスを正規化（UUID・数字IDを :id にまとめ、画面単位で集計できるようにする） */
export function normalizeOpsPath(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 200)
}
