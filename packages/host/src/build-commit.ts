import type { BuildCommit } from "@repo/settings/update";

declare const PACKAGED_BUILD_COMMIT: BuildCommit | null | undefined;

export function buildCommit(): BuildCommit | undefined {
  try {
    return PACKAGED_BUILD_COMMIT ?? undefined;
  } catch {
    return undefined;
  }
}
