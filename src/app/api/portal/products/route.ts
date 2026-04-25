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

export async function GET(_req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await getSupabaseAdminClient();
  const { data: products } = await admin
    .from("products")
    .select("id, name, base_unit, price_per_unit")
    .eq("tenant_id", session.tenant_id)
    .eq("is_active", true)
    .order("sort_order");

  return NextResponse.json(products ?? []);
}
