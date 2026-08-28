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
 * The channel a run belongs to, and the identity split's other face: the
 * released app is a standing installation the development channels run
 * beside, never in place of. The release channel is the one users hold; the
 * development channel is `electron .` from a checkout; and the ad-hoc channel
 * is a locally packaged build under an ad-hoc signature. Each keeps its own
 * name, state directory, Keychain entry, and single-instance lock, so a
 * development launch never contends with the released instance — replacing a
 * running build is `scripts/run.sh`'s act, and it reaches only the
 * development channels.
 */
export const APP_CHANNEL = {
  RELEASE: "release",
  DEVELOPMENT: "development",
  AD_HOC: "ad-hoc",
} as const;

export type AppChannel = (typeof APP_CHANNEL)[keyof typeof APP_CHANNEL];

/**
 * The channel this run belongs to. Both facts must hold for the release
 * channel: a bundle built for release but launched unpackaged runs under the
 * Electron dev binary's signature, which is exactly the mismatch the split
 * exists to prevent.
 */
export function resolveAppChannel({ packaged, developerIdSigned }: AppIdentityContext): AppChannel {
  if (!packaged) return APP_CHANNEL.DEVELOPMENT;
  return developerIdSigned ? APP_CHANNEL.RELEASE : APP_CHANNEL.AD_HOC;
}

const APP_NAME_BY_CHANNEL = {
  [APP_CHANNEL.RELEASE]: RELEASE_APP_NAME,
  [APP_CHANNEL.DEVELOPMENT]: DEVELOPMENT_APP_NAME,
  [APP_CHANNEL.AD_HOC]: AD_HOC_APP_NAME,
} as const satisfies Readonly<Record<AppChannel, string>>;

/** The name this run answers to: its channel's. */
export function resolveAppName(context: AppIdentityContext): string {
  return APP_NAME_BY_CHANNEL[resolveAppChannel(context)];
}

/**
 * What each channel splices into its observation hook artifacts' file names,
 * so the registrations two always-on channels merge into one provider's
 * configuration are each recognized only by the channel that wrote them —
 * recognition is by the installed script's name, and no qualified name
 * contains another channel's. The release channel stays unqualified because
 * the installed base already carries the bare names: entries written before
 * channels existed remain the release channel's to reconcile, whichever
 * build wrote them.
 */
export const HOOK_ARTIFACT_QUALIFIER_BY_CHANNEL = {
  [APP_CHANNEL.RELEASE]: undefined,
  [APP_CHANNEL.DEVELOPMENT]: "dev",
  [APP_CHANNEL.AD_HOC]: "test",
} as const satisfies Readonly<Record<AppChannel, string | undefined>>;

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
