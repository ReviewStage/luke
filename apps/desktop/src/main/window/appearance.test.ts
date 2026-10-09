import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { THEME, type Theme } from "@sidecar/settings";
import { Effect, Exit, Layer, Scope } from "effect";
import { applyThemePreference, followAppearance, NativeTheme } from "./appearance";

/**
 * Electron's `nativeTheme` as these effects meet it: an override that
 * resolves against the Mac's own appearance, and an `updated` event emitted
 * whenever the override is assigned or the Mac changes. The Mac starts light,
 * so a dark window can only come from the override.
 */
function fakeNativeTheme() {
  const listeners = new Set<() => void>();
  let source: Theme = THEME.SYSTEM;
  let macDark = false;
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const surface = {
    get themeSource(): Theme {
      return source;
    },
    set themeSource(next: Theme) {
      source = next;
      emit();
    },
    get shouldUseDarkColors(): boolean {
      return source === THEME.SYSTEM ? macDark : source === THEME.DARK;
    },
    on: (_event: "updated", listener: () => void) => listeners.add(listener),
    removeListener: (_event: "updated", listener: () => void) => listeners.delete(listener),
  };
  const setMacDark = (dark: boolean): void => {
    macDark = dark;
    emit();
  };
  return { layer: Layer.succeed(NativeTheme, surface), surface, setMacDark };
}

it.effect("an absent preference steers the app dark, and a chosen one as chosen", () => {
  const native = fakeNativeTheme();
  return Effect.gen(function* () {
    yield* applyThemePreference(undefined);
    assert.equal(native.surface.themeSource, THEME.DARK);
    assert.equal(native.surface.shouldUseDarkColors, true);
    // System is handed on as itself, so the Mac goes on deciding.
    yield* applyThemePreference(THEME.SYSTEM);
    assert.equal(native.surface.themeSource, THEME.SYSTEM);
    yield* applyThemePreference(THEME.LIGHT);
    assert.equal(native.surface.shouldUseDarkColors, false);
  }).pipe(Effect.provide(native.layer));
});

it.effect("the windows follow the Mac under System alone, and stop when the scope closes", () => {
  const native = fakeNativeTheme();
  return Effect.gen(function* () {
    const painted: boolean[] = [];
    const scope = yield* Scope.make();
    yield* applyThemePreference(THEME.SYSTEM);
    yield* followAppearance((dark) => painted.push(dark)).pipe(Scope.provide(scope));
    // Painted at once, in what the Mac resolves to now.
    assert.deepEqual(painted, [false]);

    native.setMacDark(true);
    assert.deepEqual(painted, [false, true]);

    yield* applyThemePreference(THEME.LIGHT);
    native.setMacDark(false);
    native.setMacDark(true);
    // Light holds whatever the Mac does.
    assert.deepEqual(painted, [false, true, false, false, false]);

    yield* Scope.close(scope, Exit.void);
    yield* applyThemePreference(THEME.DARK);
    native.setMacDark(false);
    assert.deepEqual(painted, [false, true, false, false, false]);
  }).pipe(Effect.provide(native.layer));
});

it.effect("re-applying the preference that stands repaints nothing", () => {
  const native = fakeNativeTheme();
  return Effect.gen(function* () {
    const painted: boolean[] = [];
    yield* applyThemePreference(THEME.LIGHT);
    yield* followAppearance((dark) => painted.push(dark));
    yield* applyThemePreference(THEME.LIGHT);
    yield* applyThemePreference(THEME.LIGHT);
    assert.deepEqual(painted, [false]);
  }).pipe(Effect.scoped, Effect.provide(native.layer));
});
