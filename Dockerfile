# Cloud Run 用マルチステージビルド（node:20-slim, 非root実行）。stack.md / security.md 準拠。
FROM node:20-slim AS base

# ---- deps: 依存だけを先に入れてレイヤキャッシュを効かせる ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- builder: standalone 出力を生成 ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
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
