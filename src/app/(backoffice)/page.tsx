import { getSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function BackofficeDashboard() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/(auth)/login");

  // 今日の出荷サマリー
  const today = new Date().toISOString().slice(0, 10);

  const [{ count: pendingVerification }, { count: todayOrders }, { count: pendingNotifications }] =
    await Promise.all([
      supabase
        .from("order_verification_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("delivery_date", today),
      supabase
        .from("change_notifications")
        .select("*", { count: "exact", head: true })
        .is("acknowledged_at", null),
    ]);

  const stats = [
    { label: "未検証FAX/メール", value: pendingVerification ?? 0, color: "bg-orange-100 text-orange-800", icon: "🔍" },
    { label: "本日の受注", value: todayOrders ?? 0, color: "bg-blue-100 text-blue-800", icon: "📋" },
    { label: "未確認変更通知", value: pendingNotifications ?? 0, color: "bg-red-100 text-red-800", icon: "⚠️" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">ダッシュボード</h2>
      <p className="text-gray-500 text-sm">{today}</p>

      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl p-6 ${s.color}`}>
            <div className="text-3xl mb-2">{s.icon}</div>
            <div className="text-3xl font-bold">{s.value}</div>
            <div className="text-sm font-medium mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">クイックアクション</h3>
        <div className="grid grid-cols-2 gap-3">
          <a
            href="/(backoffice)/verification-queue"
            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <span className="text-2xl">🔍</span>
            <div>
              <div className="font-medium text-gray-800">FAX/メール検証</div>
              <div className="text-sm text-gray-500">OCR結果を確認・承認</div>
            </div>
          </a>
          <a
            href="/(backoffice)/orders/new"
            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <span className="text-2xl">➕</span>
            <div>
              <div className="font-medium text-gray-800">受注手動入力</div>
              <div className="text-sm text-gray-500">電話・口頭受注を登録</div>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
