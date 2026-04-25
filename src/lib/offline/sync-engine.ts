"use client";

import { fieldDb, type OutboxMutation } from "./db";

export class SyncEngine {
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (typeof window === "undefined") return;

    window.addEventListener("online", () => this.onOnline());
    window.addEventListener("offline", () => {
      this.isOnline = false;
    });

    // 30秒ごとにアウトボックスをフラッシュ
    this.syncTimer = setInterval(() => {
      if (this.isOnline) this.flushOutbox();
    }, 30_000);

    if (this.isOnline) this.flushOutbox();
  }

  stop() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private async onOnline() {
    this.isOnline = true;
    await this.flushOutbox();
  }

  async flushOutbox() {
    const mutations = await fieldDb.outbox
      .orderBy("created_at")
      .toArray();

    for (const mutation of mutations) {
      if (mutation.retry_count >= 5) continue; // 最大5回リトライ

      try {
        await this.applyMutation(mutation);
        await fieldDb.outbox.delete(mutation.id!);
      } catch (err) {
        await fieldDb.outbox.update(mutation.id!, {
          retry_count: mutation.retry_count + 1,
          last_error: String(err),
        });
      }
    }
  }

  private async applyMutation(mutation: OutboxMutation) {
    const base = `/api/shipping-tasks/${mutation.task_id}`;

    let url: string;
    let body: string | undefined;

    switch (mutation.type) {
      case "tap":
        url = `${base}/tap`;
        break;
      case "partial":
        url = `${base}/partial`;
        body = JSON.stringify(mutation.payload);
        break;
      case "ack_change":
        url = `${base}/ack-change`;
        break;
    }

    const res = await fetch(url!, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  }

  get pendingCount() {
    return fieldDb.outbox.count();
  }
}

export const syncEngine = new SyncEngine();
