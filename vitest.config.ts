import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Cloud Run 一体型のため Node 環境でユニットテストを回す（DOM 不要のロジック中心）。
// パスエイリアス @/* は tsconfig と揃える。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // 'server-only' は Next ビルド時のみ提供される副作用インポート。Node/vitest では
      // 実体が解決できないため空スタブへ差し替え、server 専用モジュールを読み込めるようにする。
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
})
