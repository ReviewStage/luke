// build-commit.ts -- the commit `scripts/build.mjs` stamped this bundle with.
import type { BuildCommit } from "@luke/settings/update";

/**
 * Baked by `build.mjs` from `git` in the checkout the bundle was built in,
 * `null` where git could not answer. Absent under tsx — tests and tooling run
 * the sources directly — which reads as no commit, like a build made outside
 * a checkout.
 */
declare const PACKAGED_BUILD_COMMIT: BuildCommit | null | undefined;

/** The commit this bundle was built from, when the build could tell. */
export function buildCommit(): BuildCommit | undefined {
  try {
    // SAFETY: esbuild replaces this free identifier on every bundled build.
    return PACKAGED_BUILD_COMMIT ?? undefined;
  } catch {
    return undefined;
  }
}
