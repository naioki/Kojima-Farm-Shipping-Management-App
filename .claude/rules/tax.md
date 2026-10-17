---
paths:
  - "lib/calculations/**"
  - "migrations/**"
  - "**/*.sql"
  - "app/api/invoices/**"
  - "workers/src/routes/invoices*"
---

# 税率・請求計算ルール（インボイス制度対応）

## 税率の原則（最重要）

### 税率確定の場所
```sql
-- ❌ 絶対禁止：products.default_tax_rate を参照して計算
SELECT p.default_tax_rate FROM products p JOIN order_items oi ...

-- ✅ 正しい：order_items.tax_rate（注文時確定値）を使う
SELECT oi.tax_rate FROM order_items oi WHERE oi.order_id = $1
```

**理由**：商品マスタの税率が変わっても過去の請求が変わらないように、
注文時の税率を order_items と invoice_items に冗長保持する。

### 税率の種類
```typescript
type TaxRate = 8 | 10  // 8% = 農産物（軽減税率）, 10% = 送料・資材等

// 農産物: トマト, キュウリ, 小松菜, ネギ, 米 → 8%
// 資材等: 送料, 箱代, 梱包料, その他 → 10%
```

### CHECK 制約（DB必須）
```sql
-- すべての税率カラムにこの制約を付ける
CONSTRAINT valid_tax_rate CHECK (tax_rate IN (8, 10))
```

## 金額計算（Decimal.js 必須）

```typescript
// ❌ 絶対禁止：浮動小数点演算
const tax = subtotal * (taxRate / 100)  // → 0.0000001 のずれが発生

// ✅ 正しい：Decimal.js を使う
import Decimal from 'decimal.js'

export function calculateTax(subtotal: number, taxRate: 8 | 10): Decimal {
  return new Decimal(subtotal)
    .times(taxRate)
    .dividedBy(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

export function calculateLineTotal(
  quantity: number,
  unitPrice: number,
  taxRate: 8 | 10
): { subtotal: Decimal; taxAmount: Decimal; lineTotal: Decimal } {
  const subtotal = new Decimal(quantity).times(unitPrice).toDecimalPlaces(2)
  const taxAmount = calculateTax(subtotal.toNumber(), taxRate)
  return {
    subtotal,
    taxAmount,
    lineTotal: subtotal.plus(taxAmount)
  }
}
```

## 生成列（Supabase PostgreSQL）

```sql
-- order_items の計算列（DB側で計算を確定させる）
subtotal   DECIMAL(14,2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED,
tax_amount DECIMAL(14,2) GENERATED ALWAYS AS (ROUND(subtotal * tax_rate / 100, 2)) STORED,
line_total DECIMAL(14,2) GENERATED ALWAYS AS (subtotal + tax_amount) STORED
```

## 請求書生成フロー

```
受注（orders + order_items）
  ↓ 月末にまとめて集計
  ↓ customer.closing_rule に従って期間を決定
  ↓ 請求書ヘッダー作成（invoices）
  ↓ 明細コピー（invoice_items ← order_items）
  ↓ 軽減税率(8%)・標準税率(10%) を別々に合計
  ↓ PDF 生成 → Cloudflare R2 保存
  ↓ status: draft → finalized
```

## インボイス制度対応チェックリスト

PDF に必ず含める項目：
- [ ] 適格請求書発行事業者登録番号（customers.invoice_reg_num）
- [ ] 税率ごとの合計（8% 対象：¥XXX、10% 対象：¥YYY）
- [ ] 税率ごとの税額（消費税8%：¥XX、消費税10%：¥YY）
- [ ] 請求書番号（invoices.invoice_number、自動採番）
- [ ] 発行日、支払期限

## 請求書番号の採番

```typescript
// フォーマット: YYYYMM + 4桁連番（例: 202501-0001）
// gaps なし（欠番禁止 → 税務調査対応）
async function generateInvoiceNumber(
  supabase: SupabaseClient,
  billingMonth: string  // "2025-01"
): Promise<string> {
  const month = billingMonth.replace('-', '')

  // 最後の番号をロック取得（同時実行対策）
  const { data } = await supabase.rpc('get_next_invoice_number', {
    p_month: month
  })

  return `${month}-${String(data).padStart(4, '0')}`
}
```

## 監査対応（必須）

すべての請求書変更時：
```typescript
await supabase.from('audit_log').insert({
  entity_type: 'invoices',
  entity_id: invoiceId,
  action: 'UPDATE',
  changed_fields: changedFields,
  old_values: oldValues,
  new_values: newValues,
  user_id: userId
})
```

7年間保存が法的要件（Cloudflare R2 lifecycle rule で自動削除禁止期間を設定）
