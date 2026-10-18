import type { CapturedNetworkRequest, PostHog } from "posthog-js";

/**
 * What tryluke.dev counts about itself. It exists to close the funnel the
 * desktop opens: without the landing page and the sign-in, install-to-first-
 * session drop-off is only visible from the point someone already has an
 * account.
 *
 * The browser talks to the analytics processor directly, so the processor
 * sees the visitor's address and user agent. Nothing forwards on their behalf
 * — where the desktop's *counted* events still reach it through Luke's own
 * service, and its recorder now posts here directly too. Say so in
 * `PRIVACY.md` rather than letting the counted events' stronger claim bleed
 * onto either.
 *
 * The recorder here masks less than the app's: the desktop panel's recording
 * masks every word it draws (`apps/desktop/src/renderer/session-replay.ts`),
 * because the panel shows somebody's work, where this is a marketing page
 * whose copy is public and whose only typed field is a sign-in, so only what
 * is typed is masked. The two `mask_all_*` options below are autocapture's,
 * not the recorder's, and keep a press's words out of its event.
 *
 * What the client does is set here in full rather than left to the project's
 * settings, because the library turns on whatever the project's remote
 * configuration asks for wherever `init` is silent, and `PRIVACY.md` says
 * what this site collects, not what the project happens to have switched on.
 */

const PROJECT_API_KEY = import.meta.env.VITE_POSTHOG_PROJECT_API_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

export const SITE_EVENT = {
  DOWNLOAD_PRESS: "site:download_press",
  SIGN_IN_START: "site:sign_in_start",
  SIGN_IN_COMPLETE: "site:sign_in_complete",
} as const;

export type SiteEvent = (typeof SITE_EVENT)[keyof typeof SITE_EVENT];

/**
 * The pages of the OAuth sign-in flow, and the hand-off that follows it. Their
 * address carries the desktop's signed authorization request — the state, the
 * PKCE challenge, the redirect, the expiry, and the signature — or the Mac's
 * own state, challenge, and loopback for its session, each a live step of a
 * credential the funnel never needs to count. So no half of this file may
 * keep their address whole: the recorder does not run on them
 * (`disable_session_recording` below), and a counted event's every address is
 * cut to its path before it leaves (`sanitizeAnalyticsUrls`).
 */
const AUTH_PATH = {
  SIGN_IN: "/sign-in.html",
  CONSENT: "/consent.html",
  DESKTOP_SESSION: "/desktop-session.html",
} as const;

const AUTH_PATHS: ReadonlySet<string> = new Set(Object.values(AUTH_PATH));

/**
 * The query parameters that carry a credential, or a step of one, on any
 * page: an OAuth authorization code and its state, an error a provider
 * hands back, a PKCE challenge or verifier, a signed request and its
 * signature, and a bearer token by its usual names. A provider or a link may
 * land on any page with one, the landing page included, so these are taken
 * off every address that leaves, not only the sign-in pages', from its query
 * and from a fragment written as a query, where an implicit grant puts them.
 */
const AUTH_PARAM = {
  CODE: "code",
  STATE: "state",
  ERROR: "error",
  ERROR_DESCRIPTION: "error_description",
  ERROR_URI: "error_uri",
  CODE_CHALLENGE: "code_challenge",
  CODE_VERIFIER: "code_verifier",
  SIG: "sig",
  SIGNATURE: "signature",
  OAUTH_QUERY: "oauth_query",
  TOKEN: "token",
  ACCESS_TOKEN: "access_token",
  ID_TOKEN: "id_token",
  REFRESH_TOKEN: "refresh_token",
} as const;

const AUTH_PARAMS: ReadonlySet<string> = new Set(Object.values(AUTH_PARAM));

/** The library's console-log capture, which a project can switch on whatever `init` says. */
const LOGS_SCRIPT = "/logs.js";

/**
 * Where the browser keeps the id of the last Better Auth session it counted a
 * sign-in for, so a sign-in that passes more than one page that would count
 * it (consent, where it is shown, then the desktop's hand-off) is counted once.
 */
const COUNTED_SESSION_KEY = "luke_site_sign_in_session";

/** Whether the page now loading is one the sign-in flow's address serves. */
function onAuthPage(): boolean {
  return AUTH_PATHS.has(window.location.pathname);
}

/** Whether this browser already counted a sign-in for `sessionId`, marking it counted if not. */
function firstCountOf(sessionId: string): boolean {
  try {
    if (window.localStorage.getItem(COUNTED_SESSION_KEY) === sessionId) return false;
    window.localStorage.setItem(COUNTED_SESSION_KEY, sessionId);
  } catch {
    // Storage refused: count it, since a double count beats none.
  }
  return true;
}

/**
 * A query or a fragment (`?…` or `#…`) without its credential parameters, or
 * undefined when it holds none, so an address with nothing to take off is
 * never re-encoded. A part with no `=` is not written as parameters, so an
 * anchor that happens to be named `#code` is left alone.
 */
function withoutAuthParams(part: string): string | undefined {
  if (!part.includes("=")) return undefined;
  const params = new URLSearchParams(part.slice(1));
  const found = [...params.keys()].filter((name) => AUTH_PARAMS.has(name));
  if (found.length === 0) return undefined;
  for (const name of found) params.delete(name);
  return params.toString();
}

/** Whether a script the library is about to load is its console-log capture. */
function isLogsScript(script: HTMLScriptElement): boolean {
  return new URL(script.src, window.location.href).pathname.endsWith(LOGS_SCRIPT);
}

/**
 * Cuts an auth page's address to its origin and path, dropping the query and
 * the fragment that carry the authorization request, and takes the
 * credential-bearing parameters off every other address's query and
 * fragment. The rest of an address is kept, so a marketing link keeps the
 * campaign that brought someone; an address with nothing to take off, and a
 * value that is not an address, are returned exactly as they came.
 */
function scrubAuthUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (AUTH_PATHS.has(url.pathname)) return `${url.origin}${url.pathname}`;
  const query = withoutAuthParams(url.search);
  const fragment = withoutAuthParams(url.hash);
  if (query === undefined && fragment === undefined) return value;
  if (query !== undefined) url.search = query;
  if (fragment !== undefined) url.hash = fragment;
  return url.toString();
}

/**
 * Rewrites every address a capture result carries — an event property, the
 * referrer, the session's entry address, and the first-seen pair PostHog
 * keeps once on the person, which rides in the top-level `$set`/`$set_once`
 * beside the properties, not within them — so no address leaves with a
 * credential in it (`scrubAuthUrl`). An address only ever sits as a string
 * value in a plain record, so the walk descends into those alone: an array (a
 * recording's `$snapshot_data`, whose addresses the recorder's own hook
 * rewrites, and an autocaptured element list) and a class instance (the
 * capture result's `Date` timestamp) are each a leaf, left whole.
 */
/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion --
   PostHog's capture result is the untyped JSON this boundary parses, so the
   walk branches on each node's runtime shape and the assertions restate the
   branch the `typeof`/prototype guard just proved. */
export function sanitizeAnalyticsUrls<Value>(value: Value): Value {
  if (typeof value === "string") return scrubAuthUrl(value) as Value;
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [key, sanitizeAnalyticsUrls(inner)]),
      ) as Value;
    }
  }
  return value;
}
/* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

/**
 * The client, once it has loaded. It is imported dynamically rather than at
 * the top of this module because the library is larger than everything else
 * the site ships put together: a static import would land it in the shared
 * chunk, so every page — the privacy document included — would block on it.
 * Deferring also makes the kill switch literal, since a build with no key
 * never fetches the chunk at all.
 */
let client: Promise<PostHog | undefined> | undefined;

/**
 * Starts counting, or does nothing at all. A build carrying no project key is
 * inert rather than broken — the same kill switch the recording endpoint has,
 * so a preview deployment or a local run measures nothing without being
 * configured to.
 *
 * Called from every page the site builds, not only the landing one: a funnel
 * that saw the landing page alone would undercount everyone who arrived by a
 * link.
 */
export function startSiteAnalytics(): void {
  const projectApiKey = PROJECT_API_KEY;
  if (client || !projectApiKey) return;
  client = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(projectApiKey, {
      api_host: HOST,
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: false,
      // Visitors stay personless until they sign in, which is both cheaper
      // and the honest shape: an anonymous visitor is not a person Luke
      // knows. The identify where a sign-in completes (`completeSiteSignIn`)
      // is what links their earlier page views to the account, so no aliasing
      // is needed.
      person_profiles: "identified_only",
      // Autocapture's own two: an event says what was clicked and where, never
      // the words on it. Recording is configured separately below, because
      // rrweb does not read either of these.
      mask_all_text: true,
      mask_all_element_attributes: true,
      // The sign-in flow's address is a live authorization request, so the
      // recorder never runs on its pages, and no event or recording on any
      // page keeps a credential in an address.
      disable_session_recording: onAuthPage(),
      // A sign-in page leaves for the desktop the moment its sign-in is
      // counted, and the library gzips an unbatched event, the identify among
      // them, on a promise before it posts it, which a page that has already
      // left never gets to. Uncompressed, the post starts within the call, on a
      // keepalive request the browser finishes after the page has gone.
      disable_compression: onAuthPage(),
      before_send: (event) => event && sanitizeAnalyticsUrls(event),
      session_recording: {
        // The sign-in address is the only thing anybody types on this site,
        // and it is the one thing here worth masking.
        maskAllInputs: true,
        blockSelector: ".ph-block",
        // No request's headers or body, whatever the project's settings say.
        recordHeaders: false,
        recordBody: false,
        // The recorder's own hook for every address it writes: the page's
        // address in each snapshot, each navigation, and each network entry.
        maskCapturedNetworkRequestFn: (request: CapturedNetworkRequest) => ({
          ...request,
          name: scrubAuthUrl(request.name),
        }),
      },
      // Everything below is off whatever the project's settings say, because
      // `PRIVACY.md` does not offer it: no exceptions, no console in a
      // recording or as logs, no network timing or web vitals, no heatmaps or
      // dead clicks, no Conversations widget, surveys, or product tours, and
      // no feature flags, which nothing on this site reads. Console logs are
      // the one the library lets a project switch on over `init`, so their
      // script is refused from loading at all.
      capture_exceptions: false,
      enable_recording_console_log: false,
      logs: { captureConsoleLogs: false },
      prepare_external_dependency_script: (script) => (isLogsScript(script) ? null : script),
      capture_performance: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_conversations: true,
      disable_surveys: true,
      disable_product_tours: true,
      advanced_disable_feature_flags: true,
    });
    return posthog;
  });
}

/**
 * Runs one call against the client, whenever it arrives. A press landing
 * before the chunk does still counts, because it queues behind the load; a
 * chunk that never arrives costs nothing but the count.
 */
function withClient(use: (posthog: PostHog) => void): void {
  void client?.then((posthog) => posthog && use(posthog)).catch(() => undefined);
}

/** What the person record holds beyond the id it is keyed by. */
export interface SiteVisitor {
  name?: string;
  email?: string;
}

/**
 * Names the visitor by the account they just created. The id is the same
 * opaque database id the desktop's events resolve to, which is what joins the
 * two halves of the funnel; the name and address ride as person properties,
 * the same two fields the account itself holds and the service attaches to
 * desktop events.
 */
export function identifySiteVisitor(userId: string, visitor: SiteVisitor = {}): void {
  withClient((posthog) => posthog.identify(userId, visitor));
}

export function captureSiteEvent(event: SiteEvent): void {
  withClient((posthog) => posthog.capture(event));
}

/** What a completed sign-in left the browser holding, as Better Auth's `getSession` answers it. */
export interface SiteSession {
  readonly session: { readonly id: string };
  readonly user: { readonly id: string; readonly name?: string; readonly email?: string };
}

/**
 * What `pending` has already settled to, without waiting for it: undefined
 * while it is still pending, or where it failed. Note that this reads as
 * "settled now" because `Promise.race` subscribes in order, so a promise that
 * has settled queues its answer ahead of the `undefined` beside it.
 */
async function settledNow<Value>(pending: Promise<Value>): Promise<Value | undefined> {
  return Promise.race([pending, undefined]).catch(() => undefined);
}

/**
 * Where the two halves of the funnel join: names the visitor by the account
 * the browser just signed in as (`identifySiteVisitor`) and counts
 * `site:sign_in_complete`, once per Better Auth session however many pages of
 * the flow call it.
 *
 * It waits on no request: the session (`signedIn`, which the caller starts
 * reading beside its own work) is used only where it has already arrived,
 * and the sign-in is not counted where it has not, because a sign-in page
 * hands off to the desktop the moment this resolves and a count is not worth
 * holding up the Mac's sign-in for. The client is waited for, because it is
 * this site's own script, started as the page loaded, and loads or fails
 * without reaching PostHog.
 *
 * Resolves once both have been handed to the browser to send, so the caller
 * may leave the page on the next line. Note that the client is shut down to
 * get there, because the library otherwise batches an event for a few
 * seconds and flushes on unload, and a sign-in page leaves at once for the
 * desktop's loopback; its shutdown sends what is queued as a beacon, which
 * the browser delivers after the page has gone.
 */
export async function completeSiteSignIn(
  signedIn: Promise<SiteSession | null | undefined>,
): Promise<void> {
  const posthog = await client?.catch(() => undefined);
  const account = await settledNow(signedIn);
  if (!posthog || !account) return;
  const { id, name, email } = account.user;
  posthog.identify(id, { name, email });
  if (firstCountOf(account.session.id)) posthog.capture(SITE_EVENT.SIGN_IN_COMPLETE);
  await posthog.shutdown();
}
