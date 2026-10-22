/**
 * session-replay.ts -- the desktop panel window's answer to session replay: the masked recording `@luke/panel/session-replay` runs, filed under the release build's project and an address that names no one's disk.
 *
 * What is recorded, and what is masked, is the shared controller's
 * (`packages/panel/src/session-replay.ts`), which every shell records
 * through, so the rule is stated once. What this file decides on its own is
 * what only the desktop has: the project key a release build carries, the
 * address this `file://` page says it has, and the recorder's bundle, which
 * the desktop's build emits as an entry of its own. Whether to record at all
 * is the main process's word: an ordinary packaged run records, a
 * development, fixture, or capture run does not, and a run whose account was
 * deleted stops. There is no switch — `PRIVACY.md` is where a user learns
 * this happens, so that file carries the whole of the disclosure and has to
 * keep doing it.
 */

import type { BundleImporter } from "@luke/panel/bundle-loader";
import {
  type ApplySessionReplay,
  SESSION_REPLAY_APP,
  sessionReplay,
  withoutOwnAddress,
} from "@luke/panel/session-replay";
import type { UnparsedWireValue } from "@luke/wire";

/**
 * What this window says its address is, in place of the one it has.
 *
 * The renderer is a `file://` page, so its real address is a path on the
 * developer's own disk — a packaged install sits under `/Users/<name>/`, which
 * names them. A logical address rather than an empty one, because these
 * properties also feed the library's own URL matching, and matching against
 * nothing is its own surprise.
 */
const RENDERER_ADDRESS = "app://luke/panel";

/**
 * Where macOS keeps home folders, and so where the account name sits in any
 * absolute path on this machine. A path under it is the thing this whole
 * parser exists to stop, whatever produced it.
 */
const ACCOUNTS_DIRECTORY = "/Users/";

/**
 * The directory this page was loaded from, which is also where its scripts
 * are — so it is where a captured exception's stack frames point, and those
 * name `panel.js` and its chunks rather than the document itself.
 *
 * Read off `globalThis` rather than `window` so the parser can be exercised
 * with no document at all, where there is no address to match and every value
 * passes through.
 */
function loadedFrom(): string | undefined {
  const path = globalThis.location?.pathname;
  if (path === undefined) return undefined;
  const directory = path.slice(0, path.lastIndexOf("/") + 1);
  // A page at the filesystem root would match everything, which is not a
  // narrowing at all; the two rules either side of this still cover it.
  return directory.length > 1 ? directory : undefined;
}

/**
 * Whether a value is an address on this machine, in any of the forms one takes
 * here: the whole `file://` address, a path under the directory this page and
 * its scripts were loaded from, or any absolute path under the accounts
 * directory.
 *
 * Three rules rather than one equality, because equality only ever matched the
 * document. The library also reports a bare path beside the address, an
 * exception names the script each frame came from, and either can be spelled
 * differently from `location.pathname` — encoded, or simply a sibling file —
 * and still name the same person. The referrer properties come through
 * untouched of their own accord: a page opened as a file has no referrer, so
 * the library records the same `$direct` any unreferred visit gets.
 */
function namesThisMachine(value: string): boolean {
  if (value.startsWith("file://") || value.startsWith(ACCOUNTS_DIRECTORY)) return true;
  const directory = loadedFrom();
  return directory !== undefined && value.startsWith(directory);
}

/** The address scrub this window records under, by itself, for what reads it without a recording. */
const ADDRESS = { address: RENDERER_ADDRESS, namesOwnAddress: namesThisMachine } as const;

/** Takes this machine's path out of anything on its way to the processor, wherever it sits. */
export function withoutLocalAddress(value: UnparsedWireValue): UnparsedWireValue {
  return withoutOwnAddress(value, ADDRESS);
}

/**
 * The project the recording is filed under, fixed at build time, and baked
 * only into a Developer ID release build (`scripts/package-config.mjs`'s
 * `replayProjectKeyDefine`). A build without one records nothing — the same
 * kill switch the site's own counting has, so a local run or an unconfigured
 * build measures nothing rather than measuring into production's project.
 */
declare const PACKAGED_POSTHOG_PROJECT_API_KEY: string | undefined;

function projectApiKey(): string {
  try {
    // SAFETY: esbuild replaces this free identifier when it bundles the
    // renderer; a run that never went through the bundler has no such global,
    // and reading one throws rather than answering undefined.
    return PACKAGED_POSTHOG_PROJECT_API_KEY ?? "";
  } catch {
    return "";
  }
}

/** The recorder's bundle, imported where the bundler put it; it registers itself as it runs. */
const importSessionRecorder: BundleImporter<unknown> = () => import("./session-recorder/index");

/** The panel window's recording, which `desktop-platform.ts` answers the panel's platform with. */
export const applySessionReplay: ApplySessionReplay = sessionReplay({
  appName: SESSION_REPLAY_APP.DESKTOP,
  projectApiKey,
  ...ADDRESS,
  importRecorder: importSessionRecorder,
});
