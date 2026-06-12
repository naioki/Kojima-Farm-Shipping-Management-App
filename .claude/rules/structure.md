# ディレクトリ構造（Cloud Run 一体型）

```
kojima-noen/
├── app/
│   ├── layout.tsx             # next/font 設定・Providers
│   ├── globals.css            # CSS Variables・アニメーション（提供済み）
│   ├── (auth)/login/
│   ├── (dashboard)/
│   │   ├── layout.tsx         # 認証チェック + Sidebar
│   │   ├── admin/             # 経営陣（売上・請求・顧客・注文）
│   │   └── staff/             # 現場（タスク・注文参照、スマホ最優先）
│   └── api/                   # Route Handlers（PDF生成・OCR等の重い処理もここ）
├── components/
│   ├── ui/                    # Button, Input, Card...（提供済み）
│   ├── dashboard/             # KPICard, SalesChart, TaskProgressCard
│   ├── forms/ tables/ layouts/
├── lib/
│   ├── cn.ts                  # （提供済み）
│   ├── supabase/              # client.ts(browser), server.ts(SSR), admin.ts(service_role)
│   ├── validators/            # Zod schemas
│   ├── calculations/          # tax.ts（Decimal.js）
│   └── audit/
├── hooks/ types/ migrations/
├── Dockerfile                 # （提供済み）
├── .dockerignore              # （提供済み）
├── next.config.js             # output:'standalone'（提供済み）
└── CLAUDE.md
```

---

# フェーズ管理

## Phase 1: デザインシステム基盤 【進行中・雛形提供済み】
- [x] globals.css（CSS Variables・アニメーション）← 提供済み、app/ に配置するだけ
- [x] tailwind.config.ts ← 提供済み
- [x] lib/cn.ts ← 提供済み
- [x] components/ui/Button.tsx / Input.tsx / Card.tsx / Skeleton.tsx ← 提供済み
- [x] Dockerfile / .dockerignore / next.config.js ← 提供済み
- [x] app/layout.tsx（next/font 統合）
- [x] Select / Modal / Toast 追加
- [x] types/database.ts

## Phase 2: DB・認証基盤
- [x] migrations/ DDL（10テーブル + RLS + 生成列）
- [x] lib/supabase/（client / server / admin）
- [ ] (auth)/login + middleware.ts

## Phase 3: 経営陣ダッシュボード
- [ ] admin/ ページ、KPICard、SalesChart（dynamic import）、InvoicesTable
- [ ] 請求書生成 API（tax.md 厳守）

## Phase 4: スタッフ向けタスク画面（スマホ最優先）
- [ ] staff/ ページ、TaskProgressCard、進捗報告フォーム

## Phase 5: 本番化
- [ ] Cloud Run デプロイ、Web Vitals 計測、WCAG AA 監査

---

# features.md フェーズ（受注・現場・B2Bポータル）

- [x] Phase A: migrations（新規4テーブル＋既存カラム）＋スマートパース＋単体テスト
- [ ] Phase B: 取り込みcron（Drive/IMAP）＋Gemini解析＋無料枠管理
- [ ] Phase C: admin 検証画面（差分・確信度・承認・Undo）
- [ ] Phase D: 圃場マトリックス（タップループ安全版・部分完了・不足アラート）
- [ ] Phase E: B2Bポータル（Magic Link・いつものセット・RLS）
- [ ] Phase F: オフライン同期（PWA/IndexedDB outbox）＋Realtime
- [ ] Phase G: 出荷指示書生成 → 請求書(invoices)フロー接続＋通知
