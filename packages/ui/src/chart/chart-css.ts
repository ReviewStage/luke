/**
 * Validators for the two strings <ChartStyle> interpolates into its injected
 * <style> block: a config entry's key (which becomes a custom property name)
 * and its color (which becomes that property's value). Every config in this
 * repository is a module-level constant, but the primitive accepts arbitrary
 * config, so the check has to live where the interpolation happens: a call
 * site that one day feeds it something observed — a provider name, a title —
 * must not be able to turn a color string into CSS of its own.
 */

/** A key is a CSS custom-property name fragment; anything beyond identifier
 * characters could close the declaration or the rule. */
const SAFE_KEY = /^[a-zA-Z_][\w-]*$/;

/** Rejects everything that could end a declaration, close or open a rule,
 * escape the style element, or smuggle a fetch or nested sheet in. */
const FORBIDDEN_COLOR_FRAGMENT = /[;{}<>]|url\(|expression\(|@import/i;

/** The color forms chart configs legitimately use: hex, a named keyword,
 * the color functions (rgb, hsl, oklch, oklab, color-mix, with nesting for
 * color-mix's arguments), and var(--x) references with an optional fallback. */
const COLOR_FORMATS = [
  /^#[0-9a-fA-F]{3,8}$/,
  /^[a-zA-Z]+$/,
  /^(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\([^;{}<>]*\)$/i,
  /^var\(--[a-zA-Z_][\w-]*(?:\s*,\s*[^;{}<>]*)?\)$/,
] as const;

export function isSafeChartCssKey(key: string): boolean {
  return SAFE_KEY.test(key);
}

export function isSafeChartCssColor(color: string): boolean {
  const trimmed = color.trim();
  return (
    trimmed.length > 0 &&
    !FORBIDDEN_COLOR_FRAGMENT.test(trimmed) &&
    COLOR_FORMATS.some((format) => format.test(trimmed))
  );
}
