/** @type {import('next').NextConfig} */
module.exports = {
  output: 'standalone', // Cloud Run コンテナ用（必須）
  images: { formats: ['image/avif', 'image/webp'] },
  poweredByHeader: false,
}
