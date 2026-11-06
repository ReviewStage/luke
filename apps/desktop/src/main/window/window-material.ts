const LIQUID_GLASS_SINCE = 26;

export const WINDOW_MATERIAL = {
  LIQUID_GLASS: "liquid-glass",
  SIDEBAR: "sidebar",
} as const;

export type WindowMaterial = (typeof WINDOW_MATERIAL)[keyof typeof WINDOW_MATERIAL];

export function windowMaterialFor(systemVersion: string): WindowMaterial {
  const major = Number.parseInt(systemVersion.split(".")[0] ?? "", 10);
  return Number.isFinite(major) && major >= LIQUID_GLASS_SINCE
    ? WINDOW_MATERIAL.LIQUID_GLASS
    : WINDOW_MATERIAL.SIDEBAR;
}
