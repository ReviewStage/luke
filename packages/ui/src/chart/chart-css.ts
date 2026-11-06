const SAFE_KEY = /^[a-zA-Z_][\w-]*$/;

const FORBIDDEN_COLOR_FRAGMENT = /[;{}<>]|url\(|expression\(|@import/i;

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
