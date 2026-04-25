import { getSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MatrixTimeline } from "@/components/field/MatrixTimeline";

export default async function FieldPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/(auth)/login");

  const { data: profile } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/(auth)/login");

  return <MatrixTimeline tenantId={profile.tenant_id} />;
}
