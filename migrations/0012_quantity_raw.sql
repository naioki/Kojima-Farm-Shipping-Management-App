-- order_items に生OCRテキストを保持（設計書 G6 / fax-ocr-design.md §7-2）
-- parseQuantity の解釈根拠を残す。quantity は正規化済み総数。
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity_raw TEXT;
