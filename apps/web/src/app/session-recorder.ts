/**
 * session-recorder.ts -- the session recorder's own chunk in the web app: the library's recorder script, which registers itself where the client finds it (`@luke/panel/session-recorder/contract`).
 *
 * Imported only by `web-session-replay.ts`, the first time a tab is to be
 * recorded, so a tab that never records never fetches it, and served from
 * the site's own origin, since the app's policy admits no script from
 * elsewhere.
 */

import "posthog-js/dist/posthog-recorder";
