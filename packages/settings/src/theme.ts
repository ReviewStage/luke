import type { UnparsedWireValue } from "@sidecar/wire";
import { Schema } from "effect";

/**
 * Whether Luke draws light or dark, or follows the Mac. The words are
 * Electron's own `nativeTheme.themeSource` values, so the stored choice is
 * handed to the app as it stands; System is stored as itself rather than as
 * whatever the Mac resolves to now, so it goes on following the Mac.
 */
export const THEME = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

/** Settings offers the themes in this order. */
export const THEME_LIST: readonly Theme[] = Object.values(THEME);

const readsTheme = Schema.is(Schema.Literals(THEME_LIST));

/** Guards a theme arriving from storage or IPC. */
export function isTheme(value: UnparsedWireValue): value is Theme {
  return readsTheme(value);
}
