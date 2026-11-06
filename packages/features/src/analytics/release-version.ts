const RELEASE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseReleaseVersion(
  text: string,
): readonly [major: number, minor: number, patch: number] | undefined {
  const match = RELEASE_VERSION_PATTERN.exec(text.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
