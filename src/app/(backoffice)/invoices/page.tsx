import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function InvoicesPage() {
  const supabase = await getSupabaseServerClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(`*, customers!inner(name)`)
    .order("invoice_date", { ascending: false })
    .limit(100);

  const STATUS_STYLE: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    sent: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-700",
    cancelled: "bg-gray-200 text-gray-500",
  };

  const STATUS_LABEL: Record<string, string> = {
    draft: "下書き",
    sent: "送付済",
    paid: "入金済",
    overdue: "期限超過",
    cancelled: "キャンセル",
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">🧾 請求書</h2>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {["請求書番号", "得意先", "請求日", "対象期間", "合計金額", "状態", "PDF"].map(
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
            {(invoices ?? []).map((inv: any) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono text-gray-800">
                  {inv.invoice_number}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {inv.customers?.name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {inv.invoice_date}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {inv.period_from} 〜 {inv.period_to}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-gray-800">
                  ¥{Number(inv.total_amount).toLocaleString("ja-JP")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                      STATUS_STYLE[inv.status] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {STATUS_LABEL[inv.status] ?? inv.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {inv.pdf_storage_path ? (
                    <a
                      href={`/api/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      📄 ダウンロード
                    </a>
                  ) : (
                    <a
                      href={`/api/invoices/${inv.id}/pdf`}
                      className="text-xs text-green-600 hover:underline"
                    >
                      ⚙️ 生成
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {(!invoices || invoices.length === 0) && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-400">
                  請求書データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
