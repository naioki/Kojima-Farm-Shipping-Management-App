import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const deliveryDate = searchParams.get("delivery_date");

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let query = supabase
    .from("orders")
    .select(
      `
      *,
      customers!inner(name),
      order_items(*, products!inner(name, base_unit))
    `
    )
    .order("delivery_date", { ascending: false });

  if (status) query = query.eq("status", status);
  if (deliveryDate) query = query.eq("delivery_date", deliveryDate);

  const { data, error } = await query.limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { customer_id, delivery_date, notes, items } = body;

  if (!customer_id || !delivery_date || !items?.length) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 403 });

  const { tenant_id } = profile;

  // 受注作成（手動入力は即時 confirmed）
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      tenant_id,
      customer_id,
      source: "manual",
      delivery_date,
      status: "confirmed",
      notes,
      created_by: user.id,
    })
    .select()
    .single();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  // 明細を挿入（単位換算はサーバー側で実行）
  const itemsToInsert = await Promise.all(
    items.map(async (item: any) => {
      // 単位換算
      const { data: converted } = await supabase.rpc("convert_unit", {
        p_tenant_id: tenant_id,
        p_product_id: item.product_id,
        p_qty: item.ordered_qty,
        p_from_unit: item.ordered_unit,
        p_to_unit: item.base_unit,
      });

      return {
        tenant_id,
        order_id: order.id,
        product_id: item.product_id,
        ordered_qty: item.ordered_qty,
        ordered_unit: item.ordered_unit,
        converted_qty: converted ?? item.ordered_qty,
        unit_price: item.unit_price ?? 0,
        tax_rate: item.tax_rate ?? 0.1,
      };
    })
  );

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(itemsToInsert);

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json(order, { status: 201 });
}
