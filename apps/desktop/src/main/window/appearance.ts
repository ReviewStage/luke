import { APP_SETTING_SCHEMA, type Theme } from "@sidecar/settings";
import { Context, Effect, type Scope } from "effect";

/**
 * The slice of Electron's `nativeTheme` this process steers: the override it
 * sets, the appearance that override resolves to, and the event saying the
 * resolution moved. A service rather than an import because it is this
 * process's one door to the Mac's appearance, so a test stands a Layer of its
 * own on it; `nativeTheme` itself satisfies it, and the window service hands
 * that in.
 */
export interface NativeThemeSurface {
  themeSource: Theme;
  readonly shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): void;
  removeListener(event: "updated", listener: () => void): void;
}

export class NativeTheme extends Context.Service<NativeTheme, NativeThemeSurface>()(
  "@luke/desktop/NativeTheme",
) {}

/**
 * Steers the whole app to a stored theme preference. `themeSource` is what
 * the renderers' `prefers-color-scheme`, the native window chrome, and the
 * menus all follow, so this one assignment is the theme everywhere, and it
 * neither reloads nor remounts a window. An absent preference is the schema's
 * default. Note that an override already standing is not assigned again,
 * because every published document passes through here and each assignment
 * is a round trip through AppKit that emits `updated`.
 */
export const applyThemePreference = /* @__PURE__ */ Effect.fn("desktop/applyThemePreference")(
  function* (preference: Theme | undefined) {
    const theme = yield* NativeTheme;
    const wanted = preference ?? APP_SETTING_SCHEMA.theme.default;
    if (theme.themeSource !== wanted) theme.themeSource = wanted;
  },
);

/**
 * Hands `repaint` whether the app draws dark now, and again each time that
 * moves — a new preference applied, or the Mac changing under a System
 * preference — until the scope closes, which takes the listener back.
 */
export const followAppearance = (
  repaint: (dark: boolean) => void,
): Effect.Effect<void, never, NativeTheme | Scope.Scope> =>
  Effect.gen(function* () {
    const theme = yield* NativeTheme;
    const updated = (): void => repaint(theme.shouldUseDarkColors);
    updated();
    yield* Effect.acquireRelease(
      Effect.sync(() => theme.on("updated", updated)),
      () => Effect.sync(() => theme.removeListener("updated", updated)),
    );
  });
