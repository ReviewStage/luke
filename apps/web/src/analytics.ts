import { POSTHOG_PROXY } from "@repo/features/posthog-proxy";
import type { CapturedNetworkRequest, PostHog } from "posthog-js";

const PROJECT_API_KEY = import.meta.env.VITE_POSTHOG_PROJECT_API_KEY;

export const SITE_EVENT = {
  DOWNLOAD_PRESS: "site:download_press",
  SIGN_IN_START: "site:sign_in_start",
  SIGN_IN_COMPLETE: "site:sign_in_complete",
} as const;

export type SiteEvent = (typeof SITE_EVENT)[keyof typeof SITE_EVENT];

const AUTH_PATH = {
  SIGN_IN: "/sign-in",
  CONSENT: "/consent",
  DESKTOP_SESSION: "/desktop-session",
} as const;

const AUTH_PATHS: ReadonlySet<string> = new Set(
  Object.values(AUTH_PATH).flatMap((path) => [path, `${path}.html`]),
);

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

const LOGS_SCRIPT = "/logs.js";

const COUNTED_SESSION_KEY = "app_site_sign_in_session";

function onAuthPage(): boolean {
  return AUTH_PATHS.has(window.location.pathname);
}

function firstCountOf(sessionId: string): boolean {
  try {
    if (window.localStorage.getItem(COUNTED_SESSION_KEY) === sessionId) return false;
    window.localStorage.setItem(COUNTED_SESSION_KEY, sessionId);
  } catch {}
  return true;
}

function withoutAuthParams(part: string): string | undefined {
  if (!part.includes("=")) return undefined;
  const params = new URLSearchParams(part.slice(1));
  const found = [...params.keys()].filter((name) => AUTH_PARAMS.has(name));
  if (found.length === 0) return undefined;
  for (const name of found) params.delete(name);
  return params.toString();
}

function isLogsScript(script: HTMLScriptElement): boolean {
  return new URL(script.src, window.location.href).pathname.endsWith(LOGS_SCRIPT);
}

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

let client: Promise<PostHog | undefined> | undefined;

export function startSiteAnalytics(): void {
  const projectApiKey = PROJECT_API_KEY;
  if (client || !projectApiKey) return;
  client = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(projectApiKey, {
      api_host: POSTHOG_PROXY.PATH,
      ui_host: POSTHOG_PROXY.UI_ORIGIN,
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: false,
      person_profiles: "identified_only",
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_session_recording: onAuthPage(),
      disable_compression: onAuthPage(),
      request_batching: !onAuthPage(),
      before_send: (event) => event && sanitizeAnalyticsUrls(event),
      session_recording: {
        maskAllInputs: true,
        blockSelector: ".ph-block",
        recordHeaders: false,
        recordBody: false,
        maskCapturedNetworkRequestFn: (request: CapturedNetworkRequest) => ({
          ...request,
          name: scrubAuthUrl(request.name),
        }),
      },
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

function withClient(use: (posthog: PostHog) => void): void {
  void client?.then((posthog) => posthog && use(posthog)).catch(() => undefined);
}

export function captureSiteEvent(event: SiteEvent): void {
  withClient((posthog) => posthog.capture(event));
}

export interface SiteSession {
  readonly session: { readonly id: string };
  readonly user: { readonly id: string; readonly name?: string; readonly email?: string };
}

const SIGN_IN_COUNT_DEADLINE_MS = 2_000;

export function signInCountDeadline(): AbortSignal {
  return AbortSignal.timeout(SIGN_IN_COUNT_DEADLINE_MS);
}

export async function completeSiteSignIn(
  signedIn: Promise<SiteSession | null | undefined>,
): Promise<void> {
  const posthog = await client?.catch(() => undefined);
  if (!posthog) return;
  const account = await signedIn.catch(() => undefined);
  if (!account) return;
  const { id, name, email } = account.user;
  posthog.identify(id, { name, email });
  if (firstCountOf(account.session.id)) posthog.capture(SITE_EVENT.SIGN_IN_COMPLETE);
}
