import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { parseFaxImage } from "@/lib/gemini/fax-ocr";

// HMAC-SHA256 署名でwebhookの正当性を検証
function verifyWebhookSignature(
  body: Buffer,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret)
    .update(body)
    .digest("hex");
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
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-webhook-signature");
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (webhookSecret && !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // マルチパートフォームデータとして再パース
  const formData = await new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: rawBody,
  }).formData();

  const faxImage = formData.get("fax_image") as File | null;
  const tenantSlug = formData.get("tenant_slug") as string | null;

  if (!faxImage || !tenantSlug) {
    return NextResponse.json(
      { error: "fax_image and tenant_slug required" },
      { status: 400 }
    );
  }

  const admin = await getSupabaseAdminClient();

  // slug → tenant_id を解決（クライアントから tenant_id を信頼しない）
  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }
  const tenantId = tenant.id;

  // 画像を Supabase Storage に保存
  const bytes = await faxImage.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const storagePath = `${tenantId}/faxes/${Date.now()}.jpg`;

  const { error: uploadError } = await admin.storage
    .from("raw-inputs")
    .upload(storagePath, buffer, { contentType: faxImage.type || "image/jpeg" });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Gemini Vision API でOCR解析
  const base64 = buffer.toString("base64");
  let parsedData = null;
  let confidence = 0;

  try {
    const result = await parseFaxImage(
      base64,
      (faxImage.type as "image/jpeg") || "image/jpeg"
    );
    parsedData = result;
    confidence = result.confidence;
  } catch (err) {
    console.error("Gemini OCR failed:", err);
  }

  // 検証キューのみ作成（ordersはバックオフィス承認後にトリガーで生成）
  const { data: queueItem, error: queueError } = await admin
    .from("order_verification_queue")
    .insert({
      tenant_id: tenantId,
      source: "fax",
      raw_data: {
        storage_path: storagePath,
        original_filename: faxImage.name,
        size_bytes: buffer.byteLength,
      },
      parsed_data: parsedData,
      ocr_confidence: confidence,
      raw_storage_path: storagePath,
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
