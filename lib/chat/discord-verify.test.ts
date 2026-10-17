import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { verifyDiscordSignature, ed25519PublicKeyFromHex } from './discord-verify'

/**
 * 署名検証は本 Issue の最重要点。node:crypto だけで鍵生成→署名→検証が通ること、
 * 改竄で失敗することを確認する（外部署名ライブラリは使わない）。
 */

// テスト内で Ed25519 鍵ペアを生成し、生の32byte公開鍵(hex)と署名器を用意する。
function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  // SPKI DER 末尾32byteが生公開鍵。
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const rawPublic = spki.subarray(spki.length - 32)
  return { privateKey, publicKeyHex: rawPublic.toString('hex') }
}

function sign(privateKey: crypto.KeyObject, timestamp: string, body: string): string {
  const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(body, 'utf8')])
  return crypto.sign(null, message, privateKey).toString('hex')
}

describe('verifyDiscordSignature', () => {
  const timestamp = '1700000000'
  const rawBody = JSON.stringify({ type: 1, application_id: '123' })

  it('正しい署名は通過する', () => {
    const { privateKey, publicKeyHex } = makeKeypair()
    const signatureHex = sign(privateKey, timestamp, rawBody)
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp, rawBody })).toBe(true)
  })

  it('改竄された本文は失敗する', () => {
    const { privateKey, publicKeyHex } = makeKeypair()
    const signatureHex = sign(privateKey, timestamp, rawBody)
    expect(
      verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp, rawBody: rawBody + 'x' }),
    ).toBe(false)
  })

  it('改竄された署名は失敗する', () => {
    const { privateKey, publicKeyHex } = makeKeypair()
    const signatureHex = sign(privateKey, timestamp, rawBody)
    // 末尾1文字を差し替え（hexとして有効なまま値を変える）。
    const last = signatureHex.slice(-1)
    const tampered = signatureHex.slice(0, -1) + (last === '0' ? '1' : '0')
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex: tampered, timestamp, rawBody })).toBe(false)
  })

  it('別の鍵の公開鍵では失敗する', () => {
    const a = makeKeypair()
    const b = makeKeypair()
    const signatureHex = sign(a.privateKey, timestamp, rawBody)
    expect(
      verifyDiscordSignature({ publicKeyHex: b.publicKeyHex, signatureHex, timestamp, rawBody }),
    ).toBe(false)
  })

  it('timestamp が違えば失敗する（リプレイ本文を別 ts で使い回せない）', () => {
    const { privateKey, publicKeyHex } = makeKeypair()
    const signatureHex = sign(privateKey, timestamp, rawBody)
    expect(
      verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp: '1700000001', rawBody }),
    ).toBe(false)
  })

  it('鍵・署名・timestamp が欠けていれば例外を投げず false', () => {
    const { publicKeyHex } = makeKeypair()
    expect(verifyDiscordSignature({ publicKeyHex: '', signatureHex: 'ab', timestamp, rawBody })).toBe(false)
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex: '', timestamp, rawBody })).toBe(false)
    expect(verifyDiscordSignature({ publicKeyHex, signatureHex: 'ab', timestamp: '', rawBody })).toBe(false)
  })

  it('不正な hex（長さ不一致の公開鍵）でも例外を投げず false', () => {
    const signatureHex = 'ab'.repeat(32)
    expect(
      verifyDiscordSignature({ publicKeyHex: 'zz', signatureHex, timestamp, rawBody }),
    ).toBe(false)
    expect(
      verifyDiscordSignature({ publicKeyHex: 'ab', signatureHex, timestamp, rawBody }),
    ).toBe(false)
  })

  it('ed25519PublicKeyFromHex は 32byte 以外を拒否する', () => {
    expect(() => ed25519PublicKeyFromHex('ab')).toThrow()
    // 正規の32byte鍵は KeyObject を返す。
    const { publicKeyHex } = makeKeypair()
    expect(ed25519PublicKeyFromHex(publicKeyHex).asymmetricKeyType).toBe('ed25519')
  })
})
