/**
 * web-session-replay.ts -- the web app's answer to session replay: the masked recording `@luke/panel/session-replay` runs, filed under the site's project from the production deployment alone, with an address that names nothing of the tab's, and stood down in every tab when one deletes the account.
 *
 * What is recorded, and what is masked, is the shared controller's
 * (`packages/panel/src/session-replay.ts`), the same the desktop's panel
 * window records through, so the tab records exactly what the Mac app does:
 * every word masked. Whether to record at all is the host's word, as on the
 * desktop. What this file decides is only what is the tab's own: the project
 * key, the address it says it has, where its recorder's chunk is, and what
 * the other tabs of this browser say.
 *
 * Each tab runs a host of its own, so an account deleted in one tab is
 * nothing its neighbours' hosts hear of: their next read finds the session
 * gone and says recording may go on, signed out. The tab that deleted it
 * says so on `RECORDING_CHANNEL`, and every other tab stands its recording
 * down for the rest of its life, as the deleting tab's host does for its
 * own, until that tab sees a sign-in after the sign-out that follows.
 */

import type { AppPlatform } from "@luke/panel/app-platform";
import type { BundleImporter } from "@luke/panel/bundle-loader";
import {
  type ApplySessionReplay,
  SESSION_REPLAY_APP,
  sessionReplay,
} from "@luke/panel/session-replay";

/** The host's word on recording, as the panel hands it to the platform. */
type SessionReplayBootstrap = Parameters<AppPlatform["applySessionReplay"]>[0];

/** The path the web app is served at whatever it was opened on (`vercel.json`), which names nothing. */
const APP_PATH = "/app";

/**
 * A path on this origin, as the library reports one bare (`$pathname` and
 * its first-seen twins): a single leading slash and no whitespace. A
 * stylesheet's text, which can open with a comment, is not one.
 */
const OWN_PATH = /^\/(?![/*])\S*$/u;

/**
 * Where the recording's client keeps its person and its consent, apart from
 * the site's own counting (`src/analytics.ts`), which runs a client of the
 * same project on this origin: under the library's names, a stop's opt-out
 * and reset, on an account's deletion, would silence and forget the site's
 * counting too.
 */
const RECORDING_STORAGE = {
  persistence: "luke_app_replay",
  consent: "luke_app_replay_consent",
} as const;

/** What may follow the origin in an address on it: its path, its query, or its fragment. */
const AFTER_ORIGIN = new Set(["/", "?", "#"]);

/** Vercel's name for the deployment the only build that records is served from. */
const PRODUCTION_DEPLOYMENT = "production";

/** Where the tabs of this browser tell each other about the recording. */
const RECORDING_CHANNEL = "luke-session-replay";

/** What one tab tells the others on `RECORDING_CHANNEL`. */
const RECORDING_NOTICE = {
  /** The account was deleted here: stand recording down. */
  ACCOUNT_DELETED: "account-deleted",
} as const;

/** Vercel's name for the deployment this build was made for, which `vite.config.ts` writes in. */
declare const WEB_DEPLOYMENT: string | undefined;

function deployment(): string {
  try {
    // SAFETY: Vite replaces this free identifier when it bundles the app; a
    // module that never went through the bundler has no such global, and
    // reading one throws rather than answering undefined.
    return WEB_DEPLOYMENT ?? "";
  } catch {
    return "";
  }
}

/**
 * The project the recording is filed under: the site's own, the one its
 * counting already uses (`src/analytics.ts`), and only in a build for the
 * production deployment. A Preview, a development server, and a build
 * without the key record nothing, as a desktop build without its release
 * key does.
 */
function projectApiKey(): string {
  if (deployment() !== PRODUCTION_DEPLOYMENT) return "";
  return import.meta.env.VITE_POSTHOG_PROJECT_API_KEY ?? "";
}

/**
 * Whether a value is the tab's address, in either form the library takes
 * it: an address on this origin, or a bare path on it, and not another
 * host's whose name merely begins with this one's. Note that every
 * address of the site's is replaced, not only the one the tab is at,
 * because the panel writes each step into the tab's address as it moves, so
 * an event queued before a step names a path the tab has since left, and
 * a path names the workspace and the task, agent, or person it opens, and
 * may carry a query a link or a sign-in put there.
 */
function namesThisTab(value: string): boolean {
  if (OWN_PATH.test(value)) return true;
  if (!value.startsWith(location.origin)) return false;
  const next = value.charAt(location.origin.length);
  return next === "" || AFTER_ORIGIN.has(next);
}

/**
 * Whether a value is the page that sent the person to this tab, or that
 * page's host: another site's address, which can carry a thread, a search,
 * or a token of its own, and which the library puts on every event of the
 * session it opened (`$session_entry_referrer` and its domain) whatever
 * `save_referrer` says.
 */
function namesReferrer(value: string): boolean {
  const referrer = document.referrer;
  if (referrer === "") return false;
  if (value === referrer) return true;
  return URL.canParse(referrer) && value === new URL(referrer).host;
}

/** Whether a value is an address the recording must not carry: the tab's own, or the one it was sent from. */
function namesAddress(value: string): boolean {
  return namesThisTab(value) || namesReferrer(value);
}

/** The recorder's chunk, imported where the bundler put it; it registers itself as it runs. */
const importSessionRecorder: BundleImporter<unknown> = () => import("./session-recorder");

/** The tab's own recording, before the other tabs have their say. */
const recording: ApplySessionReplay = sessionReplay({
  appName: SESSION_REPLAY_APP.WEB,
  projectApiKey,
  address: `${location.origin}${APP_PATH}`,
  namesOwnAddress: namesAddress,
  importRecorder: importSessionRecorder,
  storage: RECORDING_STORAGE,
});

/** The host's latest word on recording, which a notice from another tab stands down. */
let latest: SessionReplayBootstrap | undefined;

/**
 * Set from another tab's deletion until this tab has seen the account go and
 * a sign-in after: until then every word is answered as recording's end.
 */
let held: { signedOutSince: boolean } | undefined;

/** The host's word as it stands under a hold from another tab's deletion, which a sign-in after a sign-out lifts. */
function underHold(bootstrap: SessionReplayBootstrap): SessionReplayBootstrap {
  if (held === undefined) return bootstrap;
  if (bootstrap.accountId === undefined) held.signedOutSince = true;
  else if (held.signedOutSince) held = undefined;
  return held === undefined ? bootstrap : { ...bootstrap, permitted: false };
}

/** The channel the tabs of this browser share. */
const channel = new BroadcastChannel(RECORDING_CHANNEL);

channel.addEventListener("message", (event) => {
  if (event.data !== RECORDING_NOTICE.ACCOUNT_DELETED) return;
  held = { signedOutSince: false };
  if (latest !== undefined) recording({ ...latest, permitted: false });
});

/**
 * The tab's recording, which `web-platform.ts` answers the panel's platform
 * with. A host here says recording may not go on only once the account is
 * deleted, so its word turning from yes to no is a deletion, which every
 * other tab hears of.
 */
export const applyWebSessionReplay: ApplySessionReplay = (bootstrap, importRecorder) => {
  if (latest?.permitted && !bootstrap.permitted) {
    channel.postMessage(RECORDING_NOTICE.ACCOUNT_DELETED);
  }
  latest = bootstrap;
  recording(underHold(bootstrap), importRecorder);
};
