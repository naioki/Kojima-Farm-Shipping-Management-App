import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { MatrixData } from "@/types/database";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deliveryDate = searchParams.get("delivery_date");

  if (!deliveryDate) {
    return NextResponse.json({ error: "delivery_date required" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("shipping_tasks")
    .select(
      `
      id,
      customer_id,
      product_id,
      delivery_date,
      assigned_qty,
      tap_state,
      is_partial,
      packed_qty,
      has_unack_change,
      customers!inner(name),
      products!inner(name),
      change_notifications(delta)
    `
    )
    .eq("delivery_date", deliveryDate)
    .order("customer_id")
    .order("product_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((t: any) => ({
    task_id: t.id,
    customer_id: t.customer_id,
    customer_name: t.customers?.name ?? "",
    product_id: t.product_id,
    product_name: t.products?.name ?? "",
    delivery_date: t.delivery_date,
    assigned_qty: t.assigned_qty,
    tap_state: t.tap_state,
    is_partial: t.is_partial,
    packed_qty: t.packed_qty,
    has_unack_change: t.has_unack_change,
    unack_delta: t.has_unack_change
      ? (t.change_notifications?.[0]?.delta ?? null)
      : null,
  }));

  const result: MatrixData = { delivery_date: deliveryDate, rows };
  return NextResponse.json(result);
}
