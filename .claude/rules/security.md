---
paths:
  - "app/api/**"
  - "lib/supabase/**"
  - "migrations/**"
  - "Dockerfile"
---

# セキュリティルール（Cloud Run 版）

## RLS（Row Level Security）
```sql
-- すべてのテーブルに RLS を必ず有効化。新テーブル作成時はポリシーも同時作成。
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON orders FOR ALL
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "staff_own" ON harvest_tasks FOR ALL
USING (assigned_to = auth.uid());
```

## Route Handlers
- すべての API で Zod バリデーション必須
- 認証チェック：@supabase/ssr の createServerClient → getUser() で検証（getSession 単独は信用しない）
- service_role キーはサーバー専用ファイル（lib/supabase/admin.ts）のみ。'use client' ファイルから import 禁止

## セキュリティヘッダー（middleware.ts）
```ts
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000
```

## Cloud Run
- secrets は Secret Manager（--set-secrets）。環境変数直書き・コード埋め込み禁止
- Dockerfile は非 root ユーザーで実行（USER node）
- コンテナに .env ファイルを COPY しない（.dockerignore で除外）
