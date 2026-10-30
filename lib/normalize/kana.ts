/**
 * ひらがな→カタカナへ統一する（「らでぃっしゅ」⇔「ラディッシュ」のような表記ゆれを同一視する）。
 * 名称の「照合専用」に使う。表示・保存する値には適用しないこと（元の表記を保持する）。
 */
export function foldKana(s: string): string {
  return s.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
}
