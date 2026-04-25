import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { createHash, randomBytes } from "crypto";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const admin = await getSupabaseAdminClient();

  // メールアドレスから顧客を検索
  const { data: customer } = await admin
    .from("customers")
    .select("id, tenant_id, name")
    .eq("email", email)
    .eq("is_active", true)
    .single();

  if (!customer) {
    // セキュリティ: 顧客が見つからなくても成功を返す（列挙攻撃防止）
    return NextResponse.json({ ok: true });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await admin.from("magic_links").insert({
    tenant_id: customer.tenant_id,
    customer_id: customer.id,
    token_hash: tokenHash,
    email_sent_to: email,
    expires_at: expiresAt,
  });

  const magicUrl = `${process.env.NEXT_PUBLIC_APP_URL}/(portal)/auth?token=${token}`;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject: "【農業DX】注文ポータルへのログインリンク",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#c2410c;">${customer.name} 様</h2>
          <p>以下のリンクから注文ポータルにアクセスしてください。</p>
          <a href="${magicUrl}"
             style="display:inline-block;padding:14px 28px;background:#ea580c;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;">
            注文ポータルを開く
          </a>
          <p style="color:#9ca3af;font-size:12px;margin-top:16px;">
            このリンクは24時間有効です。心当たりがない場合は無視してください。
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error("Magic link email failed:", err);
  }

  return NextResponse.json({ ok: true });
}
