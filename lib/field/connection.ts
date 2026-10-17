/**
 * 接続インジケーターの状態遷移（features.md §10 失敗#4）。
 *
 * 表示の判断だけを純粋関数に切り出す（このリポジトリの方針＝壊れると現場事故に
 * つながる判定はテストで固定する）。DOM とイベント購読は ConnectionStatus が持つ。
 *
 * 守りたいルール:
 *   1. 一度も切れていないのに「つながりました」を出さない（最初からオンラインの人に
 *      意味のない通知を出すと、本当に切れたときの通知が軽く見られる）
 *   2. 復帰したときだけデータを取り直す（圏外の間に事務所が数量を直しているかもしれず、
 *      古い数字のまま梱包させない）。オンラインのままなら再取得しない
 *   3. 圏外の間は出しっぱなし（「常時表示」。復帰通知のように自動で消さない）
 */

export interface ConnectionState {
  /** いまオンラインか */
  online: boolean
  /** この画面を開いてから一度でも圏外になったか */
  everOffline: boolean
  /** 「つながりました」を出しているか（一定時間で消える） */
  showRecovered: boolean
}

export type ConnectionEvent =
  /** ブラウザの offline イベント、またはマウント時点で既に圏外だった */
  | { type: 'offline' }
  /** ブラウザの online イベント */
  | { type: 'online' }
  /** 「つながりました」の表示時間が経過した */
  | { type: 'recovered-timeout' }

export const INITIAL_CONNECTION: ConnectionState = {
  // SSR と初回描画を一致させるため online から始める（一瞬「圏外」が出るのを防ぐ）
  online: true,
  everOffline: false,
  showRecovered: false,
}

export interface ConnectionTransition {
  state: ConnectionState
  /** 復帰したのでサーバーデータを取り直すべきか */
  shouldRefresh: boolean
}

export function reduceConnection(state: ConnectionState, event: ConnectionEvent): ConnectionTransition {
  switch (event.type) {
    case 'offline':
      // 圏外は出しっぱなし。復帰通知が出ていたら引っ込める
      return {
        state: { online: false, everOffline: true, showRecovered: false },
        shouldRefresh: false,
      }

    case 'online': {
      // 切れていないのに online が来た（初回・重複イベント）→ 何も知らせない
      if (!state.everOffline) {
        return { state: { ...state, online: true, showRecovered: false }, shouldRefresh: false }
      }
      // 実際に復帰した。知らせて、かつ取り直す
      return {
        state: { online: true, everOffline: false, showRecovered: true },
        shouldRefresh: true,
      }
    }

    case 'recovered-timeout':
      return { state: { ...state, showRecovered: false }, shouldRefresh: false }
  }
}

/** 帯を出すか（圏外の間はずっと／復帰通知の間だけ）。 */
export function isBannerVisible(state: ConnectionState): boolean {
  return !state.online || state.showRecovered
}
