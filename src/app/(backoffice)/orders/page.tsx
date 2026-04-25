import { getSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function OrdersPage() {
  const supabase = await getSupabaseServerClient();

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `
      id, source, delivery_date, status, created_at, total_amount,
      customers!inner(name)
    `
    )
    .order("delivery_date", { ascending: false })
    .limit(100);

  const SOURCE_LABEL: Record<string, string> = {
    fax: "FAX",
    email: "メール",
    manual: "手動",
    b2b_portal: "ポータル",
    i_plus: "i-Plus",
  };

  const STATUS_STYLE: Record<string, string> = {
    confirmed: "bg-blue-100 text-blue-700",
    packing: "bg-yellow-100 text-yellow-700",
    shipped: "bg-green-100 text-green-700",
    invoiced: "bg-gray-100 text-gray-600",
    cancelled: "bg-red-100 text-red-600",
  };

  const STATUS_LABEL: Record<string, string> = {
    confirmed: "確認済",
    packing: "梱包中",
    shipped: "出荷済",
    invoiced: "請求済",
    cancelled: "キャンセル",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">📋 受注一覧</h2>
        <Link
          href="/(backoffice)/orders/new"
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          ＋ 新規受注
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {["得意先", "納品日", "チャネル", "ステータス", "金額", "登録日"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(orders ?? []).map((order: any) => (
              <tr
                key={order.id}
                className="hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-800">
                  {order.customers?.name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {order.delivery_date}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                    {SOURCE_LABEL[order.source] ?? order.source}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${
                      STATUS_STYLE[order.status] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {order.total_amount != null
                    ? `¥${Number(order.total_amount).toLocaleString("ja-JP")}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {new Date(order.created_at).toLocaleDateString("ja-JP")}
                </td>
              </tr>
            ))}
            {(!orders || orders.length === 0) && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-400">
                  受注データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
