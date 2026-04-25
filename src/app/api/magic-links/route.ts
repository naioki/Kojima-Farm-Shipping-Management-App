import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient, getSupabaseAdminClient } from "@/lib/supabase/server";
import { createHash, randomBytes } from "crypto";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Magic Link 生成（バックオフィスまたはシステムが呼び出す）
export async function POST(req: NextRequest) {
  const { customer_id, email } = await req.json();

  if (!customer_id || !email) {
    return NextResponse.json({ error: "customer_id and email required" }, { status: 400 });
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

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const admin = await getSupabaseAdminClient();
  const { error } = await admin.from("magic_links").insert({
    tenant_id: profile.tenant_id,
    customer_id,
    token_hash: tokenHash,
    email_sent_to: email,
    expires_at: expiresAt,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const magicUrl = `${process.env.NEXT_PUBLIC_APP_URL}/(portal)/auth?token=${token}`;

  // Resend でメール送信
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject: "【農業DX】注文ポータルへのログインリンク",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #166534;">農業DXプラットフォーム</h2>
          <p>以下のリンクからご注文ポータルにアクセスできます。</p>
          <a href="${magicUrl}"
             style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
            注文ポータルを開く
          </a>
          <p style="color:#6b7280;font-size:12px;margin-top:16px;">
            このリンクは24時間有効です。心当たりがない場合は無視してください。
          </p>
        </div>
      `,
    });
  } catch (emailErr) {
    console.error("Email send failed:", emailErr);
    // メール送信失敗はエラーとして返さない（URLを返す）
  }

  return NextResponse.json({ url: magicUrl, expires_at: expiresAt });
}

// Magic Link 検証
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const tokenHash = hashToken(token);
  const admin = await getSupabaseAdminClient();

  const { data: link, error } = await admin
    .from("magic_links")
    .select("*, customers(name, tenant_id)")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .single();

  if (error || !link) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  if (new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 401 });
  }

  // トークンを使用済みにする
  const sessionToken = randomBytes(32).toString("hex");
  await admin
    .from("magic_links")
    .update({
      used_at: new Date().toISOString(),
      session_token: sessionToken,
      ip_address: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    })
    .eq("token_hash", tokenHash);

  const response = NextResponse.json({
    customer_id: link.customer_id,
    customer_name: (link.customers as any)?.name,
    tenant_id: link.tenant_id,
    session_token: sessionToken,
  });

  // セッションをCookieに保存
  response.cookies.set("portal_session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24時間
    path: "/",
  });

  return response;
}
