import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { Invoice, InvoiceItem, Customer } from "@/types/database";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 40,
    color: "#1f2937",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    borderBottom: "2 solid #16a34a",
    paddingBottom: 12,
  },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#166534" },
  invoiceNumber: { fontSize: 11, color: "#6b7280", marginTop: 4 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  infoBlock: { flex: 1 },
  label: { fontSize: 8, color: "#9ca3af", marginBottom: 2 },
  value: { fontSize: 10, color: "#1f2937" },
  table: { marginTop: 16 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f0fdf4",
    padding: "6 4",
    borderTop: "1 solid #d1fae5",
    borderBottom: "1 solid #d1fae5",
  },
  tableRow: {
    flexDirection: "row",
    padding: "5 4",
    borderBottom: "0.5 solid #e5e7eb",
  },
  col1: { flex: 3 },
  col2: { flex: 1, textAlign: "right" },
  col3: { flex: 1, textAlign: "right" },
  col4: { flex: 1, textAlign: "right" },
  colHeader: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#166534" },
  total: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 40,
  },
  totalLabel: { fontSize: 10, color: "#6b7280" },
  totalValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#166534" },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 40,
    right: 40,
    borderTop: "0.5 solid #e5e7eb",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 8, color: "#9ca3af" },
});

interface Props {
  invoice: Invoice;
  customer: Customer;
  items: InvoiceItem[];
  farmName: string;
}

function formatJpy(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

export function InvoicePdf({ invoice, customer, items, farmName }: Props) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>請 求 書</Text>
            <Text style={styles.invoiceNumber}>
              No. {invoice.invoice_number}
            </Text>
          </View>
          <View style={{ textAlign: "right" }}>
            <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>
              {farmName}
            </Text>
            <Text style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>
              発行日: {invoice.invoice_date}
            </Text>
            {invoice.due_date && (
              <Text style={{ fontSize: 9, color: "#6b7280" }}>
                支払期限: {invoice.due_date}
              </Text>
            )}
          </View>
        </View>

        {/* 請求先 */}
        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.label}>請求先</Text>
            <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold" }}>
              {customer.name} 御中
            </Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.label}>対象期間</Text>
            <Text style={styles.value}>
              {invoice.period_from} 〜 {invoice.period_to}
            </Text>
          </View>
        </View>

        {/* 明細テーブル */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col1, styles.colHeader]}>商品名</Text>
            <Text style={[styles.col2, styles.colHeader]}>数量</Text>
            <Text style={[styles.col3, styles.colHeader]}>単価</Text>
            <Text style={[styles.col4, styles.colHeader]}>小計</Text>
          </View>
          {items.map((item, i) => (
            <View key={item.id} style={[styles.tableRow, { backgroundColor: i % 2 === 0 ? "#fff" : "#f9fafb" }]}>
              <Text style={styles.col1}>{item.product_name}</Text>
              <Text style={styles.col2}>{item.qty}</Text>
              <Text style={styles.col3}>{formatJpy(item.unit_price)}</Text>
              <Text style={styles.col4}>{formatJpy(item.line_total)}</Text>
            </View>
          ))}
        </View>

        {/* 合計 */}
        <View style={styles.total}>
          <View>
            <Text style={styles.totalLabel}>小計</Text>
            <Text style={styles.totalLabel}>消費税</Text>
            <Text style={[styles.totalLabel, { marginTop: 4, fontSize: 12 }]}>
              合計（税込）
            </Text>
          </View>
          <View style={{ textAlign: "right" }}>
            <Text style={styles.totalValue}>{formatJpy(invoice.subtotal)}</Text>
            <Text style={styles.totalValue}>{formatJpy(invoice.tax_amount)}</Text>
            <Text style={[styles.totalValue, { fontSize: 14, color: "#166534" }]}>
              {formatJpy(invoice.total_amount)}
            </Text>
          </View>
        </View>

        {/* フッター */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {farmName} | 農業DXプラットフォーム
          </Text>
          <Text style={styles.footerText}>{invoice.invoice_number}</Text>
        </View>
      </Page>
    </Document>
  );
}
