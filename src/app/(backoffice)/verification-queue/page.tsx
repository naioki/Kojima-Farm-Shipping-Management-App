import { getSupabaseServerClient } from "@/lib/supabase/server";
import { VerificationQueue } from "@/components/backoffice/VerificationQueue";

export default async function VerificationQueuePage() {
  const supabase = await getSupabaseServerClient();

  const { data: queue } = await supabase
    .from("order_verification_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">
        🔍 FAX / メール 検証キュー
      </h2>
      <p className="text-gray-500 text-sm">
        OCRで解析した受注内容を確認し、承認または修正してください。
      </p>
      <VerificationQueue items={queue ?? []} />
    </div>
  );
}
