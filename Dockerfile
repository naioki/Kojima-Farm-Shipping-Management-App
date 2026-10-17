# Cloud Run 用マルチステージビルド（node:20-slim, 非root実行）。stack.md / security.md 準拠。
FROM node:20-slim AS base

# ---- deps: 依存だけを先に入れてレイヤキャッシュを効かせる ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci は lock 厳密一致が必要。Windows 生成の lock は Linux 用 optional 依存
# （@emnapi 等のネイティブ WASM ランタイム）を欠くため Linux ビルドで落ちることがある。
# 一致すれば ci（高速・再現性）、ズレたら install にフォールバックして解決する。
RUN npm ci --no-audit --no-fund || (echo "npm ci failed; falling back to npm install" && npm install --no-audit --no-fund)

# ---- builder: standalone 出力を生成 ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* はビルド時にクライアントバンドルへ焼き込まれるため、ここで注入する。
# これらは RLS 前提でブラウザに配布される非秘匿値（service_role キーとは異なる）。
# その他のシークレット（GEMINI/R2 等）は実行時に DB(app_settings)→env で解決するので
# ここでは不要。/admin/settings から入力できる（lib/settings.ts）。
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: 最小実行イメージ。USER node で非root（security.md） ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# next.config.js の output:'standalone' が生成する最小成果物のみコピー
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
