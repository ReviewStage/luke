/**
 * web-session-replay.ts -- the web app's answer to session replay: the masked recording `@luke/panel/session-replay` runs, filed under the site's project from a production build alone, with an address that names nothing of the tab's.
 *
 * What is recorded, and what is masked, is the shared controller's
 * (`packages/panel/src/session-replay.ts`), the same the desktop's panel
 * window records through, so the tab records exactly what the Mac app does:
 * every word masked. Whether to record at all is the host's word, as on the
 * desktop. What this file decides is only what is the tab's own: the project
 * key, the address it says it has, and where its recorder's chunk is.
 */

import type { BundleImporter } from "@luke/panel/bundle-loader";
import {
  type ApplySessionReplay,
  SESSION_REPLAY_APP,
  sessionReplay,
} from "@luke/panel/session-replay";

/** The path the web app is served at whatever it was opened on (`vercel.json`), which names nothing. */
const APP_PATH = "/app";

/**
 * A path on this origin, as the library reports one bare (`$pathname` and
 * its first-seen twins): a single leading slash and no whitespace. A
 * stylesheet's text, which can open with a comment, is not one.
 */
const OWN_PATH = /^\/(?![/*])\S*$/u;

/**
 * The project the recording is filed under: the site's own, the one its
 * counting already uses (`src/analytics.ts`), read only into a production
 * build. A development server, and a build without the key, record nothing,
 * as a desktop build without its release key does.
 */
function projectApiKey(): string {
  return import.meta.env.PROD ? (import.meta.env.VITE_POSTHOG_PROJECT_API_KEY ?? "") : "";
}

/**
 * Whether a value is the tab's address, in either form the library takes
 * it: an address on this origin, or a bare path on it. Note that every
 * address of the site's is replaced, not only the one the tab is at,
 * because the panel writes each step into the tab's address as it moves, so
 * an event queued before a step names a path the tab has since left, and
 * a path names the workspace and the task, agent, or person it opens, and
 * may carry a query a link or a sign-in put there.
 */
function namesThisTab(value: string): boolean {
  return value.startsWith(location.origin) || OWN_PATH.test(value);
}

/** The recorder's chunk, imported where the bundler put it; it registers itself as it runs. */
const importSessionRecorder: BundleImporter<unknown> = () => import("./session-recorder");

/** The tab's recording, which `web-platform.ts` answers the panel's platform with. */
export const applyWebSessionReplay: ApplySessionReplay = sessionReplay({
  appName: SESSION_REPLAY_APP.WEB,
  projectApiKey,
  address: `${location.origin}${APP_PATH}`,
  namesOwnAddress: namesThisTab,
  importRecorder: importSessionRecorder,
});
