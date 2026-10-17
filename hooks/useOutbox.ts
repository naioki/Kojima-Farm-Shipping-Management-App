'use client'

import { useCallback, useEffect, useState } from 'react'
import { openDB, type IDBPDatabase } from 'idb'
import { collapseOutbox, toPatchPayload, type OutboxEntry } from '@/lib/offline/outbox'

/**
 * オフライン同期フック（features.md §7 / Phase F）。
 * タップ操作のキューイングに限定（全体オフライン化は狙わない）。
 * 圏外でも outbox(IndexedDB) に積み、オンライン復帰で順次 PATCH する。
 * 競合（409）はそのセルだけ呼び出し側で赤表示にできるよう itemId を返す。
 */
const DB_NAME = 'kojima-field'
const STORE = 'outbox'

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { autoIncrement: true })
    },
  })
}

export function useOutbox() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  /** タップを記録（楽観的UIは呼び出し側で即時反映済みの前提）。 */
  const enqueue = useCallback(async (entry: OutboxEntry) => {
    const d = await db()
    await d.add(STORE, entry)
  }, [])

  /** オンライン時に outbox を畳み込んで順次送信。競合した itemId を返す。 */
  const flush = useCallback(async (): Promise<string[]> => {
    if (!navigator.onLine) return []
    const d = await db()
    const all = (await d.getAll(STORE)) as OutboxEntry[]
    const pending = collapseOutbox(all)
    const conflicts: string[] = []
    for (const entry of pending) {
      try {
        const res = await fetch(`/api/order-items/${entry.itemId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(toPatchPayload(entry)),
        })
        if (res.status === 409) conflicts.push(entry.itemId)
        else if (!res.ok) return conflicts // ネットワーク不調なら次回に持ち越し
      } catch {
        return conflicts // 圏外に戻った等。outbox は消さない
      }
    }
    await d.clear(STORE) // 送信できたものを破棄（競合は呼び出し側で再取得して解消）
    return conflicts
  }, [])

  // 復帰時に自動フラッシュ
  useEffect(() => {
    if (online) void flush()
  }, [online, flush])

  return { online, enqueue, flush }
}
