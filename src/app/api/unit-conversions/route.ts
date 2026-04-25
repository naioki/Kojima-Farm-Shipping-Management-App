import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get("product_id");
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let query = supabase
    .from("unit_conversion_master")
    .select("*")
    .is("effective_to", null)
    .order("from_unit");

  if (productId) query = query.eq("product_id", productId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// ライブプレビュー用: 単位換算の計算
export async function POST(req: NextRequest) {
  const { product_id, qty, from_unit, to_unit } = await req.json();

  if (!product_id || !qty || !from_unit || !to_unit) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
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

  const { data: converted, error } = await supabase.rpc("convert_unit", {
    p_tenant_id: profile?.tenant_id,
    p_product_id: product_id,
    p_qty: qty,
    p_from_unit: from_unit,
    p_to_unit: to_unit,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ converted_qty: converted });
}
