import 'server-only'
import { getSetting } from '@/lib/settings'
import { parseAllowedUsers } from './discord-custom-id'

/**
 * Discord チャット自動化（統合2E-2）の設定読み取り（サーバ専用・DB=app_settings 優先→env）。
 *
 * 秘匿値（Bot Token・Public Key）はここでしか読まない。値をログ・レスポンスに出さないこと。
 * 設定編集UIは 2E-5 の担当。ここは読み取り専用で、未設定でも import・起動は壊れない
 * （すべて null / 空配列を返すだけ）。
 */
export interface DiscordConfig {
  /** Interactions の Ed25519 署名検証に使う公開鍵（32byte hex）。未設定なら検証不可＝401。 */
  publicKey: string | null
  /** ボタン付きメッセージをチャネルへ能動送信するための Bot Token。 */
  botToken: string | null
  /** 能動送信先チャネルID。 */
  channelId: string | null
  /** 操作を許可する Discord ユーザーID（空配列＝全員許可）。 */
  allowedUsers: string[]
}

export async function getDiscordConfig(): Promise<DiscordConfig> {
  const [publicKey, botToken, channelId, allowed] = await Promise.all([
    getSetting('DISCORD_PUBLIC_KEY'),
    getSetting('DISCORD_BOT_TOKEN'),
    getSetting('DISCORD_CHANNEL_ID'),
    getSetting('ALLOWED_DISCORD_USERS'),
  ])
  return {
    publicKey,
    botToken,
    channelId,
    allowedUsers: parseAllowedUsers(allowed),
  }
}

/** 承認実行者に使うアプリユーザーID設定（無ければ null → actor 解決で admin 先頭にフォールバック）。 */
export async function getActorUserIdSetting(): Promise<string | null> {
  return getSetting('CHAT_BOT_ACTOR_USER_ID')
}
