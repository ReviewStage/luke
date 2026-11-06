import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

export const THEME = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

export const THEME_LIST: readonly Theme[] = Object.values(THEME);

const readsTheme = Schema.is(Schema.Literals(THEME_LIST));

export function isTheme(value: UnparsedWireValue): value is Theme {
  return readsTheme(value);
}
