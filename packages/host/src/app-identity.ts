/**
 * Which Luke a process is: the released app, an unpackaged development run, or
 * a locally packaged test build. Each carries a different code signature — a
 * release is signed with the Developer ID identity, `electron .` runs under
 * the Electron dev binary's own signature, and a local package is ad-hoc — and
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
 * a different name is the whole separation. A build packaged and signed for
 * release answers to the product name, `electron .` answers to the development
 * name, and an ad-hoc package answers to the test name.
 *
 * A development run may also be a named instance (`run.sh --instance <name>`,
 * or the one `run.sh --preview` derives from the Preview it points at), which
 * answers to the development name followed by its own: "Luke Dev preview".
 * The name moving is again the whole separation: its own state directory,
 * and with it its own single-instance lock, sign-in, and settings, and its
 * own Keychain entry, so it runs beside the plain development instance rather
 * than replacing it. A packaged build has no instances.
 */

const RELEASE_APP_NAME = "Luke";

/**
 * Derived from the release name rather than freestanding, because
 * `scripts/lib/workspace.sh` derives it the same way to find a development
 * instance's single-instance lock; the app-identity test holds them together.
 */
const DEVELOPMENT_APP_NAME = `${RELEASE_APP_NAME} Dev`;
export const AD_HOC_APP_NAME = `${RELEASE_APP_NAME} Test`;

/**
 * A development instance's name: lower-case words of letters and digits
 * joined by single hyphens, short enough to sit in a folder's name. Note that
 * `scripts/lib/workspace.sh` holds names to the same pattern, and folds a
 * derived one (a branch, a host) into it before handing it here.
 */
const INSTANCE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INSTANCE_NAME_MAX_LENGTH = 48;

export interface AppIdentityContext {
  /** Whether this process runs from a packaged bundle rather than `electron .`. */
  packaged: boolean;
  /** Whether the bundle was built alongside Developer ID packaging. */
  developerIdSigned: boolean;
  /** The development instance this run was launched as; none for the plain one. */
  instance?: string | undefined;
}

/** Whether `name` may name a development instance. */
function isInstanceName(name: string): boolean {
  return name.length <= INSTANCE_NAME_MAX_LENGTH && INSTANCE_NAME_PATTERN.test(name);
}

/**
 * The development instance a launch asked for, or none: only an unpackaged
 * run has instances, and a name the pattern refuses is no instance at all,
 * so a packaged build and a malformed name both run as they always have.
 */
export function resolveInstance(launch: {
  packaged: boolean;
  requested: string | undefined;
}): string | undefined {
  if (launch.packaged || launch.requested === undefined) return undefined;
  return isInstanceName(launch.requested) ? launch.requested : undefined;
}

/**
 * The name this run answers to. Both facts must hold for the product name:
 * a bundle built for release but launched unpackaged runs under the Electron
 * dev binary's signature, which is exactly the mismatch the split exists to
 * prevent.
 */
export function resolveAppName({
  packaged,
  developerIdSigned,
  instance,
}: AppIdentityContext): string {
  if (packaged) return developerIdSigned ? RELEASE_APP_NAME : AD_HOC_APP_NAME;
  return instance === undefined ? DEVELOPMENT_APP_NAME : `${DEVELOPMENT_APP_NAME} ${instance}`;
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
