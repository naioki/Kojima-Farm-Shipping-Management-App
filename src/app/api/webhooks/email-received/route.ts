import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { parseEmailOrder } from "@/lib/gemini/email-parser";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenant_id, from, subject, text, html } = body;

  if (!tenant_id || (!text && !html)) {
    return NextResponse.json({ error: "tenant_id and email body required" }, { status: 400 });
  }

  const emailText = text || html.replace(/<[^>]*>/g, " "); // HTMLタグを除去

  let parsedData = null;
  let confidence = 0;

  try {
    const result = await parseEmailOrder(emailText);
    parsedData = result;
    confidence = result.confidence;
  } catch (err) {
    console.error("Gemini email parse failed:", err);
  }

  const admin = await getSupabaseAdminClient();

  // 受注レコード作成
  const { data: order } = await admin
    .from("orders")
    .insert({
      tenant_id,
      customer_id: "00000000-0000-0000-0000-000000000000",
      source: "email",
      delivery_date: parsedData?.delivery_date ?? new Date().toISOString().slice(0, 10),
      status: "confirmed",
      notes: `From: ${from}\nSubject: ${subject}`,
      parsed_data: parsedData,
    })
    .select()
    .single();

  // 検証キューへ追加
  await admin.from("order_verification_queue").insert({
    tenant_id,
    source: "email",
    raw_data: { from, subject, body_preview: emailText.slice(0, 500) },
    parsed_data: parsedData,
    ocr_confidence: confidence,
  });

  return NextResponse.json({ ok: true, order_id: order?.id }, { status: 202 });
}
