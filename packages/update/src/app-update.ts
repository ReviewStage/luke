/**
 * Whether a published release is newer than the running app.
 *
 * Releases are named by plain three-part versions, optionally led by the tag
 * convention's `v`. Anything else — a prerelease suffix, a truncated tag, a
 * sentence — does not parse, and an unparseable version never reads as newer:
 * offering an update the build cannot name would send someone to fetch
 * something this comparison never understood.
 */

const RELEASE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseReleaseVersion(
  text: string,
): readonly [major: number, minor: number, patch: number] | undefined {
  const match = RELEASE_VERSION_PATTERN.exec(text.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True only when both versions parse and the candidate is strictly newer. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parsedCandidate = parseReleaseVersion(candidate);
  const parsedCurrent = parseReleaseVersion(current);
  if (!parsedCandidate || !parsedCurrent) return false;
  const [candidateMajor, candidateMinor, candidatePatch] = parsedCandidate;
  const [currentMajor, currentMinor, currentPatch] = parsedCurrent;
  if (candidateMajor !== currentMajor) return candidateMajor > currentMajor;
  if (candidateMinor !== currentMinor) return candidateMinor > currentMinor;
  return candidatePatch > currentPatch;
}
