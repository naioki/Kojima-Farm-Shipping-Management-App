import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// 受注数量変更（バックオフィスによる修正）
// order_items.revised_qty を更新 → DB トリガーが自動的に
// shipping_tasks を更新 + change_notifications を挿入する
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const body = await req.json();
  const { items } = body as {
    items: Array<{ item_id: string; revised_qty: number }>;
  };

  if (!items?.length) {
    return NextResponse.json({ error: "items required" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "backoffice"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const errors: string[] = [];

  for (const { item_id, revised_qty } of items) {
    if (revised_qty < 0) {
      errors.push(`item ${item_id}: revised_qty must be >= 0`);
      continue;
    }

    const { error } = await supabase
      .from("order_items")
      .update({
        revised_qty,
        revised_at: now,
        revised_by: user.id,
        updated_at: now,
      })
      .eq("id", item_id)
      .eq("order_id", orderId); // orderId との紐付けを確認（他テナントの item を変更不可）

    if (error) errors.push(`item ${item_id}: ${error.message}`);
  }

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 207 }); // 207 Multi-Status
  }

  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("orders")
    .select(
      `*, customers!inner(name, code),
       order_items(*, products!inner(name, base_unit))`
    )
    .eq("id", orderId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}
