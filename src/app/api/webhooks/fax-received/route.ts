import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { parseFaxImage } from "@/lib/gemini/fax-ocr";

export async function POST(req: NextRequest) {
  // FAXプロバイダーからのWebhook（マルチパートフォームデータ）
  const formData = await req.formData();
  const faxImage = formData.get("fax_image") as File | null;
  const tenantId = formData.get("tenant_id") as string | null;

  if (!faxImage || !tenantId) {
    return NextResponse.json(
      { error: "fax_image and tenant_id required" },
      { status: 400 }
    );
  }

  const admin = await getSupabaseAdminClient();

  // 画像をSupabase Storageに保存
  const bytes = await faxImage.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const storagePath = `${tenantId}/faxes/${Date.now()}.jpg`;

  const { error: uploadError } = await admin.storage
    .from("raw-inputs")
    .upload(storagePath, buffer, { contentType: faxImage.type });

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

  // 受注を pending 状態で作成
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: "00000000-0000-0000-0000-000000000000", // 未確定（検証時に更新）
      source: "fax",
      delivery_date: parsedData?.delivery_date ?? new Date().toISOString().slice(0, 10),
      status: "confirmed", // 検証後に更新される
      raw_input_ref: storagePath,
      parsed_data: parsedData,
    })
    .select()
    .single();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  // 検証キューへ追加
  await admin.from("order_verification_queue").insert({
    tenant_id: tenantId,
    source: "fax",
    raw_data: { storage_path: storagePath, original_filename: faxImage.name },
    parsed_data: parsedData,
    ocr_confidence: confidence,
    raw_storage_path: storagePath,
  });

  return NextResponse.json({ ok: true, order_id: order.id }, { status: 202 });
}
