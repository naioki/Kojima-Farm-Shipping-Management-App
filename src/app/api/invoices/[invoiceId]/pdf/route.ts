import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { InvoicePdf } from "@/lib/pdf/invoice-template";
import React from "react";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 請求書・得意先・明細を取得
  const { data: invoice, error: invError } = await supabase
    .from("invoices")
    .select("*, customers!inner(*)")
    .eq("id", invoiceId)
    .single();

  if (invError || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const { data: items } = await supabase
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId);

  // テナント名を取得
  const { data: profile } = await supabase
    .from("users")
    .select("tenant_id, tenants!inner(name)")
    .eq("id", user.id)
    .single();

  const farmName = (profile as any)?.tenants?.name ?? "農場名";

  // @react-pdf/renderer で PDF を生成
  const pdfBuffer = await renderToBuffer(
    React.createElement(InvoicePdf, {
      invoice,
      customer: (invoice as any).customers,
      items: items ?? [],
      farmName,
    })
  );

  // Supabase Storage に保存（次回以降はキャッシュを返す）
  const storagePath = `${(profile as any)?.tenant_id}/invoices/${invoiceId}.pdf`;
  await supabase.storage
    .from("invoices")
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  await supabase
    .from("invoices")
    .update({ pdf_storage_path: storagePath })
    .eq("id", invoiceId);

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${invoice.invoice_number}.pdf"`,
    },
  });
}
