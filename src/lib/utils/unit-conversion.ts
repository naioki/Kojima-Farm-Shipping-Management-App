import type { UnitConversionMaster } from "@/types/database";

export function applyConversion(
  qty: number,
  fromUnit: string,
  toUnit: string,
  conversions: UnitConversionMaster[]
): number {
  if (fromUnit === toUnit) return qty;

  const rule = conversions.find(
    (c) =>
      c.from_unit === fromUnit &&
      c.to_unit === toUnit &&
      c.effective_to === null
  );

  if (!rule) {
    throw new Error(
      `単位換算ルールが見つかりません: ${fromUnit} → ${toUnit}`
    );
  }

  return Math.round(qty * rule.multiplier * 1000) / 1000;
}

export function formatQty(qty: number, unit: string): string {
  const rounded = Math.round(qty * 10) / 10;
  return `${rounded} ${unit}`;
}
