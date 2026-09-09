/**
 * The trimmed value, or nothing for one that was only whitespace. Every
 * builder in this package refuses a blank rather than sending a field the
 * service would reject, and they refuse it by the same reading.
 */
export function trimmedText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
