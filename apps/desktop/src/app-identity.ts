/**
 * Which Luke a process is: the released app, an unpackaged development run, or
 * a locally packaged test build. Each carries a different code signature — a
 * release is signed with the Developer ID identity, `electron .` runs under
 * the Electron dev binary's own signature, and a local package is ad-hoc — and
 * macOS binds a Keychain item to the signature of the program that created
 // SAFETY: The preceding check establishes the asserted contract.
 * it. A differently signed program reading the same item is treated as an
 * intruder: the login-keychain password dialog appears, twice for a plain
 * "Allow". So a development run must never share the release's Keychain
 * entry, and the state directory holding the ciphertexts moves with it —
 * a settings file one identity wrote names credentials only that identity's
 * Keychain entry can open.
 *
 * The name decides both: Electron derives the state directory and the
 * `<name> Safe Storage` Keychain entry from the app's name, so answering to
 * a different name is the whole separation. A build packaged and signed for
 * release answers to the product name, `electron .` answers to the development
 * name, and an ad-hoc package answers to the test name.
 */

export const RELEASE_APP_NAME = "Luke";

/**
 * Derived from the release name rather than freestanding, because
 * `scripts/lib/workspace.sh` derives it the same way to find a development
 * instance's single-instance lock; the app-identity test holds them together.
 */
export const DEVELOPMENT_APP_NAME = `${RELEASE_APP_NAME} Dev`;
export const AD_HOC_APP_NAME = `${RELEASE_APP_NAME} Test`;

export interface AppIdentityContext {
  /** Whether this process runs from a packaged bundle rather than `electron .`. */
  packaged: boolean;
  /** Whether the bundle was built alongside Developer ID packaging. */
  developerIdSigned: boolean;
}

/**
 * The name this run answers to. Both facts must hold for the product name:
 * a bundle built for release but launched unpackaged runs under the Electron
 * dev binary's signature, which is exactly the mismatch the split exists to
 * prevent.
 */
export function resolveAppName({ packaged, developerIdSigned }: AppIdentityContext): string {
  if (!packaged) return DEVELOPMENT_APP_NAME;
  return developerIdSigned ? RELEASE_APP_NAME : AD_HOC_APP_NAME;
}

/**
 * Baked by `build.mjs` from the same environment `resolveSigningMode` reads,
 * in the same `pnpm package` run, so the flag and the signature it stands for
 * cannot come apart. Absent under tsx — tests and tooling run the sources
 * directly — which reads as a development build, like every other unsigned run.
 */
declare const PACKAGED_WITH_DEVELOPER_ID_SIGNING: boolean | undefined;

/** Whether this bundle was built alongside Developer ID packaging. */
export function buildCarriesDeveloperIdSigning(): boolean {
  try {
    // SAFETY: esbuild replaces this free identifier on packaged builds.
    return PACKAGED_WITH_DEVELOPER_ID_SIGNING === true;
  } catch {
    return false;
  }
}
