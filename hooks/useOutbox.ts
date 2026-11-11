'use client'

import { useCallback, useEffect, useState } from 'react'
import { openDB, type IDBPDatabase } from 'idb'
import { showResponseWarnings } from '@/lib/client/show-warnings'
import {
  collapseOutbox,
  toPatchPayload,
  calcBackoffMs,
  type OutboxEntry,
  type ShipmentOutboxEntry,
} from '@/lib/offline/outbox'

/**
 * オフライン同期フック（features.md §7 / Phase F）。
 * - STORE_TAP ('outbox'): セルタップ（PATCH /api/order-items/[id]）のキュー
 * - STORE_SHIPMENT ('shipment_outbox'): 新規・増減出荷（POST /api/shipments）のキュー
 *
 * 【重要バグ防止】
 * 1. module-level lock (`activeFlushPromise`) と retry timer により、ShipmentRow が 50 行マウントされた状態でも
 *    オンライン復帰時に `flush()` が 50 並列発火して重複登録されるのを完全に防ぐ（1プロセスのみ実行）。
 * 2. IndexedDB v1 → v2 アップグレード時の接続ブロッキング（blocked）を防ぎ、安全にストアを開設する。
 * 3. 送信成功したエントリのみを個別に削除し、フラッシュ中に新しく追加されたエントリが `clear()` で消えるのを防ぐ。
 */
const DB_NAME = 'kojima-field'
const DB_VERSION = 2
const STORE_TAP = 'outbox'
const STORE_SHIPMENT = 'shipment_outbox'

let dbPromise: Promise<IDBPDatabase> | null = null
let activeFlushPromise: Promise<string[]> | null = null
let retryTimerId: ReturnType<typeof setTimeout> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE_TAP)) {
          d.createObjectStore(STORE_TAP, { autoIncrement: true })
        }
        if (!d.objectStoreNames.contains(STORE_SHIPMENT)) {
          d.createObjectStore(STORE_SHIPMENT, { keyPath: 'id' })
        }
      },
      blocked() {
        console.warn('[useOutbox] IndexedDB upgrade blocked by an older tab')
      },
      blocking() {
        dbPromise = null
      },
    }).catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

export function useOutbox() {
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refreshPendingCount = useCallback(async () => {
    try {
      const d = await db()
      const tapCount = await d.count(STORE_TAP)
      const shipCount = d.objectStoreNames.contains(STORE_SHIPMENT)
        ? await d.count(STORE_SHIPMENT)
        : 0
      setPendingCount(tapCount + shipCount)
    } catch {
      // IndexedDB unavailable in SSR
    }
  }, [])

  useEffect(() => {
    setOnline(navigator.onLine)
    void refreshPendingCount()
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const onSyncEvent = () => void refreshPendingCount()
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener('kojima-outbox-changed', onSyncEvent)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('kojima-outbox-changed', onSyncEvent)
    }
  }, [refreshPendingCount])

  const notifyOutboxChanged = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kojima-outbox-changed'))
    }
  }

  /** タップを記録（楽観的UIは呼び出し側で即時反映済みの前提）。 */
  const enqueue = useCallback(
    async (entry: OutboxEntry) => {
      const d = await db()
      await d.add(STORE_TAP, entry)
      await refreshPendingCount()
      notifyOutboxChanged()
    },
    [refreshPendingCount],
  )

  /** 出荷追加・増減（POST /api/shipments）をオフラインキューに記録。 */
  const enqueueShipment = useCallback(
    async (
      payload: ShipmentOutboxEntry['payload'],
      summaryLabel: string,
    ): Promise<ShipmentOutboxEntry> => {
      const entry: ShipmentOutboxEntry = {
        id: `ship_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        payload,
        summaryLabel,
        ts: Date.now(),
        retryCount: 0,
      }
      const d = await db()
      await d.put(STORE_SHIPMENT, entry)
      await refreshPendingCount()
      notifyOutboxChanged()
      return entry
    },
    [refreshPendingCount],
  )

  /** オンライン時に outbox と shipment_outbox を排他ロック付きで順次送信。競合した itemId を返す。 */
  const flush = useCallback(async (): Promise<string[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return []
    if (activeFlushPromise) return activeFlushPromise

    if (retryTimerId) {
      clearTimeout(retryTimerId)
      retryTimerId = null
    }

    setSyncing(true)
    activeFlushPromise = (async () => {
      const conflicts: string[] = []
      try {
        const d = await db()

        // 1. セルタップ（PATCH）のフラッシュ（キー付き取得で処理済みキーのみ安全削除）
        const txTapRead = d.transaction(STORE_TAP, 'readonly')
        const tapStore = txTapRead.objectStore(STORE_TAP)
        const tapKeys = await tapStore.getAllKeys()
        const tapValues = (await tapStore.getAll()) as OutboxEntry[]
        await txTapRead.done

        if (tapValues.length > 0) {
          const pendingTaps = collapseOutbox(tapValues)
          let tapAborted = false
          for (const entry of pendingTaps) {
            try {
              const res = await fetch(`/api/order-items/${entry.itemId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(toPatchPayload(entry)),
              })
              if (res.status === 409) conflicts.push(entry.itemId)
              else if (!res.ok) {
                tapAborted = true
                break
              }
            } catch {
              tapAborted = true
              break
            }
          }
          if (!tapAborted) {
            const txDel = d.transaction(STORE_TAP, 'readwrite')
            for (const k of tapKeys) {
              await txDel.objectStore(STORE_TAP).delete(k)
            }
            await txDel.done
          }
        }

        // 2. 出荷登録（POST /api/shipments）のフラッシュ
        if (d.objectStoreNames.contains(STORE_SHIPMENT)) {
          const allShipments = (await d.getAll(STORE_SHIPMENT)) as ShipmentOutboxEntry[]
          const sortedShipments = [...allShipments].sort((a, b) => a.ts - b.ts)
          for (const shipEntry of sortedShipments) {
            try {
              const res = await fetch('/api/shipments', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(shipEntry.payload),
              })
              if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
                // 送信できたが付随更新（収穫数など）に失敗した場合の警告を出す
                if (res.ok) showResponseWarnings(await res.json().catch(() => null))
                await d.delete(STORE_SHIPMENT, shipEntry.id)
              } else {
                const updated: ShipmentOutboxEntry = {
                  ...shipEntry,
                  retryCount: shipEntry.retryCount + 1,
                }
                await d.put(STORE_SHIPMENT, updated)
                if (!retryTimerId) {
                  retryTimerId = setTimeout(() => {
                    retryTimerId = null
                    void flush()
                  }, calcBackoffMs(updated.retryCount))
                }
                break
              }
            } catch {
              const updated: ShipmentOutboxEntry = {
                ...shipEntry,
                retryCount: shipEntry.retryCount + 1,
              }
              await d.put(STORE_SHIPMENT, updated)
              if (!retryTimerId) {
                retryTimerId = setTimeout(() => {
                  retryTimerId = null
                  void flush()
                }, calcBackoffMs(updated.retryCount))
              }
              break
            }
          }
        }
      } finally {
        activeFlushPromise = null
        await refreshPendingCount()
        notifyOutboxChanged()
        setSyncing(false)
      }
      return conflicts
    })()

    return activeFlushPromise
  }, [refreshPendingCount])

  // 復帰時に自動フラッシュ
  useEffect(() => {
    if (online) void flush()
  }, [online, flush])

  return { online, pendingCount, syncing, enqueue, enqueueShipment, flush }
}
