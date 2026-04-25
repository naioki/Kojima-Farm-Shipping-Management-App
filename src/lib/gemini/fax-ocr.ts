import { getVisionModel } from "./client";

export interface ParsedOrderItem {
  product_code: string;
  product_name: string;
  quantity: number;
  unit: string;
}

export interface ParsedFaxOrder {
  customer_code: string | null;
  customer_name: string | null;
  delivery_date: string | null; // ISO 8601
  items: ParsedOrderItem[];
  raw_notes: string | null;
  confidence: number; // 0.0 - 1.0
}

const SYSTEM_PROMPT = `
あなたは農産物のFAX注文書を解析する専門AIです。
画像からFAX注文書を読み取り、以下のJSON形式で情報を抽出してください。

出力形式（必ずこのJSONのみを返してください）:
{
  "customer_code": "得意先コード（例: C001）またはnull",
  "customer_name": "得意先名またはnull",
  "delivery_date": "納品日（YYYY-MM-DD形式）またはnull",
  "items": [
    {
      "product_code": "商品コードまたは空文字",
      "product_name": "商品名",
      "quantity": 数量（数値）,
      "unit": "単位（バラ/箱/kg等）"
    }
  ],
  "raw_notes": "その他の注記やメモ",
  "confidence": 0.0から1.0の読み取り信頼度
}

注意事項:
- 日付は今年（${new Date().getFullYear()}年）基準で解釈してください
- 数量は必ず数値で返してください
- 読み取れない場合はnullを返してください
`;

export async function parseFaxImage(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/tiff" | "application/pdf"
): Promise<ParsedFaxOrder> {
  const model = getVisionModel();

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    SYSTEM_PROMPT,
  ]);

  const text = result.response.text().trim();

  // JSON部分を抽出
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gemini response does not contain valid JSON");
  }

  try {
    return JSON.parse(jsonMatch[0]) as ParsedFaxOrder;
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${text.slice(0, 200)}`);
  }
}
