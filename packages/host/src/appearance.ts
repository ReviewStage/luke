import { APP_SETTING_SCHEMA, type Theme } from "@repo/settings";
import { Context, Effect } from "effect";

export interface NativeThemeSurface {
  themeSource: Theme;
  readonly shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): void;
  removeListener(event: "updated", listener: () => void): void;
}

export class NativeTheme extends Context.Service<NativeTheme, NativeThemeSurface>()(
  "@repo/desktop/NativeTheme",
) {}

export const applyThemePreference = Effect.fn("desktop/applyThemePreference")(function* (
  preference: Theme | undefined,
) {
  const theme = yield* NativeTheme;
  const wanted = preference ?? APP_SETTING_SCHEMA.theme.default;
  if (theme.themeSource !== wanted) theme.themeSource = wanted;
});
