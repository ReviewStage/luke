import type { PostHog } from "posthog-js";

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
 * The two masking options below are this file's own, and are the one place
 * this half is narrower than the app's: the panel records what a provider
 * wrote about somebody's work and no longer masks it, where this is a
 * marketing page whose copy is public and whose only typed field is a
 * sign-in. Masking the words costs nothing here, so nothing here spends it.
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
 * The pages of the OAuth sign-in flow. Their address carries the desktop's
 * signed authorization request — the state, the PKCE challenge, the redirect,
 * the expiry, and the signature — which is a live credential the funnel never
 * needs to count. So no half of this file may keep their address whole: the
 * recorder does not run on them (`disable_session_recording` below), and a
 * counted event's every address is cut to its path before it leaves
 * (`sanitizeAnalyticsUrls`).
 */
const AUTH_PATH = {
  SIGN_IN: "/sign-in.html",
  CONSENT: "/consent.html",
} as const;

const AUTH_PATHS: ReadonlySet<string> = new Set(Object.values(AUTH_PATH));

/** Whether the page now loading is one the sign-in flow's address serves. */
function onAuthPage(): boolean {
  return AUTH_PATHS.has(window.location.pathname);
}

/**
 * Cuts an auth page's address to its origin and path, dropping the query and
 * the fragment that carry the authorization request. Every other address is
 * returned whole, so a marketing link keeps the campaign that brought someone,
 * and a value that is not an address is returned untouched.
 */
function authUrlToPath(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  return AUTH_PATHS.has(url.pathname) ? `${url.origin}${url.pathname}` : value;
}

/**
 * Rewrites every address an event carries — the current one, the referrer, and
 * the first-seen pair PostHog keeps once on the person — so an auth page's
 * address never leaves whole, wherever in the properties it sits. Anything that
 * is not an auth page's address stays as it was.
 */
/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion --
   PostHog's properties bag is the untyped JSON this boundary parses: an address
   can sit at any depth (an event property, or the first-seen pair under
   `$set_once`), so the walk branches on each node's runtime shape and the
   assertions restate the branch the `typeof`/`Array.isArray` guard just proved. */
export function sanitizeAnalyticsUrls<Value>(value: Value): Value {
  if (typeof value === "string") return authUrlToPath(value) as Value;
  if (Array.isArray(value)) return value.map(sanitizeAnalyticsUrls) as Value;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, sanitizeAnalyticsUrls(inner)]),
    ) as Value;
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
      // knows. The identify at consent is what links their earlier page views
      // to the account, so no aliasing is needed.
      person_profiles: "identified_only",
      // Autocapture's own two: an event says what was clicked and where, never
      // the words on it. Recording is configured separately below, because
      // rrweb does not read either of these.
      mask_all_text: true,
      mask_all_element_attributes: true,
      // The sign-in flow's address is a live authorization request, so the
      // recorder never runs on its pages and no event keeps that address whole.
      disable_session_recording: onAuthPage(),
      before_send: (event) =>
        event && { ...event, properties: sanitizeAnalyticsUrls(event.properties) },
      session_recording: {
        // The sign-in address is the only thing anybody types on this site,
        // and it is the one thing here worth masking.
        maskAllInputs: true,
        blockSelector: ".ph-block",
      },
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
