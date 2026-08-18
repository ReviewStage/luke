/**
 * Which Luke a process is: the released app, or a development run standing in
 * for it. The two carry different code signatures — a release is signed with
 * the Developer ID identity, while `electron .` runs under the Electron dev
 * binary's own signature and a locally packaged app is signed ad-hoc — and
 * macOS binds a Keychain item to the signature of the program that created
 * it. A differently signed program reading the same item is treated as an
 * intruder: the login-keychain password dialog appears, twice for a plain
 * "Allow". So a development run must never share the release's Keychain
 * entry, and the state directory holding the ciphertexts moves with it —
 * a settings file one identity wrote names credentials only that identity's
 * Keychain entry can open.
 *
 * The name decides both: Electron derives the state directory and the
 * `<name> Safe Storage` Keychain entry from the app's name, so answering to
 * a different name is the whole separation. Only a build packaged and signed
 * for release answers to the product name; every other run — unpackaged, or
 * packaged without the release identity — answers to the development name.
 */

export const RELEASE_APP_NAME = "Luke";

/**
 * Derived from the release name rather than freestanding, because
 * `scripts/lib/workspace.sh` derives it the same way to find a development
 * instance's single-instance lock; the app-identity test holds them together.
 */
export const DEVELOPMENT_APP_NAME = `${RELEASE_APP_NAME} Dev`;

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
  return packaged && developerIdSigned ? RELEASE_APP_NAME : DEVELOPMENT_APP_NAME;
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
  return (
    typeof PACKAGED_WITH_DEVELOPER_ID_SIGNING === "boolean" && PACKAGED_WITH_DEVELOPER_ID_SIGNING
  );
}
