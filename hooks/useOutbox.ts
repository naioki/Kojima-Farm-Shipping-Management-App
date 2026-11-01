'use client'

import { useCallback, useEffect, useState } from 'react'
import { openDB, type IDBPDatabase } from 'idb'
import {
  collapseOutbox,
  toPatchPayload,
  calcBackoffMs,
  type OutboxEntry,
  type ShipmentOutboxEntry,
} from '@/lib/offline/outbox'

/**
 * オフライン同期フック（v6.0 Local-First Engine / features.md §7）。
 * - STORE_TAP ('outbox'): セルタップ（PATCH /api/order-items/[id]）のキュー
 * - STORE_SHIPMENT ('shipment_outbox'): 新規・増減出荷（POST /api/shipments）のキュー
 * ビニールハウス内の圏外・弱電界でも 0ms でローカル保存し、電波復帰時に指数バックオフで自動同期する。
 */
const DB_NAME = 'kojima-field'
const DB_VERSION = 2
const STORE_TAP = 'outbox'
const STORE_SHIPMENT = 'shipment_outbox'

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE_TAP)) {
        d.createObjectStore(STORE_TAP, { autoIncrement: true })
      }
      if (!d.objectStoreNames.contains(STORE_SHIPMENT)) {
        d.createObjectStore(STORE_SHIPMENT, { keyPath: 'id' })
      }
    },
  })
}

export function useOutbox() {
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refreshPendingCount = useCallback(async () => {
    try {
      const d = await db()
      const tapCount = await d.count(STORE_TAP)
      const shipCount = await d.count(STORE_SHIPMENT)
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
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [refreshPendingCount])

  /** タップを記録（楽観的UIは呼び出し側で即時反映済みの前提）。 */
  const enqueue = useCallback(
    async (entry: OutboxEntry) => {
      const d = await db()
      await d.add(STORE_TAP, entry)
      await refreshPendingCount()
    },
    [refreshPendingCount],
  )

  /** 出荷追加・増減（POST /api/shipments）をオフラインキューに記録（0ms 即時保存）。 */
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
      return entry
    },
    [refreshPendingCount],
  )

  /** オンライン時に outbox と shipment_outbox を順次送信。競合した itemId を返す。 */
  const flush = useCallback(async (): Promise<string[]> => {
    if (!navigator.onLine) return []
    setSyncing(true)
    const conflicts: string[] = []
    try {
      const d = await db()

      // 1. セルタップ（PATCH）のフラッシュ
      const allTaps = (await d.getAll(STORE_TAP)) as OutboxEntry[]
      if (allTaps.length > 0) {
        const pendingTaps = collapseOutbox(allTaps)
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
          await d.clear(STORE_TAP)
        }
      }

      // 2. 出荷登録（POST /api/shipments）のフラッシュ
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
            // 成功または恒久的バリデーションエラーはキューから除去
            await d.delete(STORE_SHIPMENT, shipEntry.id)
          } else {
            // 5xx や 429 はリトライカウントを増やして次回へ
            const updated: ShipmentOutboxEntry = {
              ...shipEntry,
              retryCount: shipEntry.retryCount + 1,
            }
            await d.put(STORE_SHIPMENT, updated)
            setTimeout(() => void flush(), calcBackoffMs(updated.retryCount))
            break
          }
        } catch {
          const updated: ShipmentOutboxEntry = {
            ...shipEntry,
            retryCount: shipEntry.retryCount + 1,
          }
          await d.put(STORE_SHIPMENT, updated)
          setTimeout(() => void flush(), calcBackoffMs(updated.retryCount))
          break
        }
      }
    } finally {
      await refreshPendingCount()
      setSyncing(false)
    }
    return conflicts
  }, [refreshPendingCount])

  // 復帰時に自動フラッシュ
  useEffect(() => {
    if (online) void flush()
  }, [online, flush])

  return { online, pendingCount, syncing, enqueue, enqueueShipment, flush }
}
