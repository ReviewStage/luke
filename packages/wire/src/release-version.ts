/**
 * The version a published release is named by, read like any other untrusted
 * string: a plain three-part version, optionally led by the tag convention's
 * `v`, and undefined for anything else. The strictness is the point — a
 * prerelease suffix, a truncated tag, or a sentence is a shape this build has
 * no rule for, and a caller that admitted it would be carrying a value it
 * cannot reason about.
 */

const RELEASE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseReleaseVersion(
  text: string,
): readonly [major: number, minor: number, patch: number] | undefined {
  const match = RELEASE_VERSION_PATTERN.exec(text.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
