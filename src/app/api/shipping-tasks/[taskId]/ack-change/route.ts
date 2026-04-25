import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date().toISOString();

  const { error: taskError } = await supabase
    .from("shipping_tasks")
    .update({
      has_unack_change: false,
      ack_change_at: now,
      acked_by: user.id,
      updated_at: now,
    })
    .eq("id", taskId);

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  // 未確認の change_notifications も既読にする
  await supabase
    .from("change_notifications")
    .update({ acknowledged_by: user.id, acknowledged_at: now })
    .eq("shipping_task_id", taskId)
    .is("acknowledged_at", null);

  return NextResponse.json({ ok: true });
}
