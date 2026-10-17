-- 0008: 顧客識別色・商品サムネイル・規格警告（UI改善フェーズ）
-- 目的:
--   - customers.display_color: タスク画面での取引先の色分け（16進数カラーコード）
--   - products.photo_url:      商品のサムネイル画像（40×40の識別用）
--   - order_items.spec_warnings: 梱包時の注意事項 [{type, text}] JSONB

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS display_color TEXT DEFAULT NULL;

COMMENT ON COLUMN customers.display_color IS
  'タスク画面での識別用カラーコード（例: #ef4444）。NULLの場合は名前から自動割り当て。';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT NULL;

COMMENT ON COLUMN products.photo_url IS
  '商品識別サムネイル（40×40px推奨）のURL。Cloudflare R2か公開URL。';

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS spec_warnings JSONB DEFAULT NULL;

COMMENT ON COLUMN order_items.spec_warnings IS
  '梱包時の注意事項。[{"type":"forbidden","text":"ダンボール NG"},{"type":"required","text":"HACCP対応"}]形式。';
