import { getVisionModel } from "./client";
import type { ParsedFaxOrder } from "./fax-ocr";

const EMAIL_PROMPT = `
あなたは農産物の注文メールを解析する専門AIです。
以下のメール本文から注文情報を抽出し、JSON形式で返してください。

出力形式（必ずこのJSONのみを返してください）:
{
  "customer_code": "得意先コードまたはnull",
  "customer_name": "発注者名またはnull",
  "delivery_date": "納品希望日（YYYY-MM-DD形式）またはnull",
  "items": [
    {
      "product_code": "商品コードまたは空文字",
      "product_name": "商品名",
      "quantity": 数量（数値）,
      "unit": "単位"
    }
  ],
  "raw_notes": "その他の備考",
  "confidence": 0.0から1.0の解析信頼度
}

今年は${new Date().getFullYear()}年です。相対的な日付表現（「来週月曜」等）はこの日付基準で解釈してください。
`;

export async function parseEmailOrder(emailText: string): Promise<ParsedFaxOrder> {
  const model = getVisionModel();

  const result = await model.generateContent([
    EMAIL_PROMPT,
    `\n以下のメール本文を解析してください:\n\n${emailText.slice(0, 4000)}`,
  ]);

  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("Gemini response does not contain valid JSON");
  }

  return JSON.parse(jsonMatch[0]) as ParsedFaxOrder;
}
