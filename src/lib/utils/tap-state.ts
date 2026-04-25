import type { TapState } from "@/types/database";

// タップループ: 0 → 1 → 2 → 0
export function nextTapState(current: TapState, isPartial: boolean): TapState {
  if (isPartial && current === 0) return 1; // 部分完了 → 梱包完了
  if (current === 0) return 1;
  if (current === 1) return 2;
  return 0; // リセット
}

export interface CellStyle {
  bgClass: string;
  icon: string | null;
  label: string;
}

export function getCellStyle(
  tapState: TapState,
  isPartial: boolean,
  hasUnackChange: boolean,
  unackDelta: number | null
): CellStyle {
  if (hasUnackChange) {
    return {
      bgClass: "bg-red-500 animate-flash-red",
      icon: null,
      label: unackDelta !== null ? (unackDelta > 0 ? `+${unackDelta}` : `${unackDelta}`) : "!",
    };
  }
  if (isPartial && tapState === 0) {
    return { bgClass: "bg-yellow-300", icon: "⌨️", label: "部分" };
  }
  switch (tapState) {
    case 0:
      return { bgClass: "bg-white", icon: null, label: "" };
    case 1:
      return { bgClass: "bg-green-400", icon: "✓", label: "" };
    case 2:
      return { bgClass: "bg-gray-400", icon: "🚚", label: "" };
  }
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  return delta > 0 ? `+${delta}` : `${delta}`;
}
