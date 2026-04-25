import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const { action } = await req.json();

  if (!["approved", "rejected"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date().toISOString();

  // 検証キューの状態を更新
  const { error: queueError } = await supabase
    .from("order_verification_queue")
    .update({
      status: action,
      reviewed_by: user.id,
      reviewed_at: now,
    })
    .eq("id", orderId);

  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }

  if (action === "approved") {
    // 対応する受注を confirmed に昇格（トリガーでシッピングタスクが自動生成される）
    const { data: queue } = await supabase
      .from("order_verification_queue")
      .select("id")
      .eq("id", orderId)
      .single();

    await supabase
      .from("orders")
      .update({
        status: "confirmed",
        verified_by: user.id,
        verified_at: now,
      })
      .eq("verification_queue_id", queue!.id);
  }

  return NextResponse.json({ ok: true });
}
