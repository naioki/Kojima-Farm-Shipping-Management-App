import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { parseEmailOrder } from "@/lib/gemini/email-parser";

function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (webhookSecret && !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody);
  const { tenant_slug, from, subject, text, html } = body;

  if (!tenant_slug || (!text && !html)) {
    return NextResponse.json(
      { error: "tenant_slug and email body required" },
      { status: 400 }
    );
  }

  const admin = await getSupabaseAdminClient();

  // slug → tenant_id を解決
  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenant_slug)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const emailText = text || (html as string).replace(/<[^>]*>/g, " ");

  let parsedData = null;
  let confidence = 0;

  try {
    const result = await parseEmailOrder(emailText);
    parsedData = result;
    confidence = result.confidence;
  } catch (err) {
    console.error("Gemini email parse failed:", err);
  }

  const { data: queueItem, error: queueError } = await admin
    .from("order_verification_queue")
    .insert({
      tenant_id: tenant.id,
      source: "email",
      raw_data: {
        from,
        subject,
        body_preview: emailText.slice(0, 500),
      },
      parsed_data: parsedData,
      ocr_confidence: confidence,
    })
    .select("id")
    .single();

  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, queue_id: queueItem.id },
    { status: 202 }
  );
}
