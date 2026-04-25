import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

async function getPortalSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("portal_session")?.value;
  if (!sessionToken) return null;

  const admin = await getSupabaseAdminClient();
  const { data: link } = await admin
    .from("magic_links")
    .select("customer_id, tenant_id")
    .eq("session_token", sessionToken)
    .single();

  return link;
}

export async function POST(req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { delivery_date, items, notes } = await req.json();

  if (!delivery_date || !items?.length) {
    return NextResponse.json({ error: "delivery_date and items required" }, { status: 400 });
  }

  const admin = await getSupabaseAdminClient();

  // B2B ポータル受注は即座に confirmed（検証キュー不要）
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: session.tenant_id,
      customer_id: session.customer_id,
      source: "b2b_portal",
      delivery_date,
      status: "confirmed",
      notes,
    })
    .select()
    .single();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  // 商品の単価・換算率を取得して明細を挿入
  const itemsToInsert = await Promise.all(
    items.map(async (item: any) => {
      const { data: product } = await admin
        .from("products")
        .select("price_per_unit, tax_rate, base_unit")
        .eq("id", item.product_id)
        .single();

      // 単位換算（ordered_unit == base_unit の場合はそのまま）
      let converted_qty = item.ordered_qty;
      if (item.ordered_unit && item.ordered_unit !== product?.base_unit) {
        const { data: c } = await admin.rpc("convert_unit", {
          p_tenant_id: session.tenant_id,
          p_product_id: item.product_id,
          p_qty: item.ordered_qty,
          p_from_unit: item.ordered_unit,
          p_to_unit: product?.base_unit ?? item.ordered_unit,
        });
        if (c) converted_qty = c;
      }

      return {
        tenant_id: session.tenant_id,
        order_id: order.id,
        product_id: item.product_id,
        ordered_qty: item.ordered_qty,
        ordered_unit: item.ordered_unit || product?.base_unit,
        converted_qty,
        unit_price: product?.price_per_unit ?? 0,
        tax_rate: product?.tax_rate ?? 0.1,
      };
    })
  );

  const { error: itemsError } = await admin.from("order_items").insert(itemsToInsert);
  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, order_id: order.id }, { status: 201 });
}
