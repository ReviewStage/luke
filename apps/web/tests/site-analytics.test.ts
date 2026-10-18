// @vitest-environment jsdom
import assert from "node:assert/strict";
import type { CaptureResult, PostHog } from "posthog-js";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sanitizeAnalyticsUrls } from "../src/analytics";

/**
 * site-analytics.test.ts -- no address the website's analytics sends carries
 * a credential, on the sign-in pages or any other, and the client collects
 * only what `PRIVACY.md` says it does however the project is configured. The
 * client is the real library, started through the site's own entry; the
 * network it posts to, and the remote configuration the project would serve,
 * are the fakes.
 */

const SIGN_IN_URL =
  "https://tryluke.dev/sign-in.html?state=github.abc&code_challenge=xyz&redirect_uri=luke%3A%2F%2Fauth&expires_at=1700000000&signature=deadbeef";
const CONSENT_URL = "https://tryluke.dev/consent.html?oauth_query=signed.payload&state=github.abc";
const AUTH_CODE = "c".repeat(64);
const LANDING_WITH_CODE = `/?code=${AUTH_CODE}&state=s1&utm_source=hn`;
const PROJECT_KEY = "phc_site_analytics_test";

/** What a project with every optional feature switched on serves as its remote configuration. */
const EVERYTHING_ON = {
  autocaptureExceptions: true,
  sessionRecording: {
    endpoint: "/s/",
    consoleLogRecordingEnabled: true,
    networkPayloadCapture: { recordBody: true, recordHeaders: true, capturePerformance: true },
  },
  capturePerformance: { network_timing: true, web_vitals: true },
  conversations: { enabled: true, token: "conversations-token" },
  logs: { captureConsoleLogs: true },
  surveys: true,
  productTours: true,
  heatmaps: true,
  captureDeadClicks: true,
  hasFeatureFlags: true,
} as const;

const sent: URL[] = [];
const captured: CaptureResult[] = [];
let posthog: PostHog;

/** The file names of the scripts the client asked the browser to load. */
function requestedScripts(): string[] {
  return [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
    (script) => new URL(script.src).pathname.split("/").at(-1) ?? "",
  );
}

beforeAll(async () => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", PROJECT_KEY);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    sent.push(new URL(input instanceof Request ? input.url : String(input)));
    return new Response("{}", { status: 200 });
  });
  window.history.replaceState(null, "", LANDING_WITH_CODE);
  Reflect.set(window, "_POSTHOG_REMOTE_CONFIG", { [PROJECT_KEY]: { config: EVERYTHING_ON } });
  // Note that the module reads its key as it loads, so it is loaded afresh
  // under the stubbed key, beside the client it will start.
  vi.resetModules();
  posthog = (await import("posthog-js")).default;
  posthog.on("eventCaptured", (event: CaptureResult) => captured.push(event));
  const { startSiteAnalytics, identifySiteVisitor } = await import("../src/analytics");
  startSiteAnalytics();
  identifySiteVisitor("user-1");
  await vi.waitFor(() => assert.ok(captured.some((event) => event.event === "$identify")));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("a sign-in address keeps its path and drops the authorization query", () => {
  const clean = sanitizeAnalyticsUrls({ $current_url: SIGN_IN_URL });
  assert.equal(clean.$current_url, "https://tryluke.dev/sign-in.html");
  assert.doesNotMatch(clean.$current_url, /state|code_challenge|signature|redirect_uri|expires_at/);
});

test("the consent address drops its authorization query too", () => {
  const clean = sanitizeAnalyticsUrls({ $current_url: CONSENT_URL });
  assert.equal(clean.$current_url, "https://tryluke.dev/consent.html");
});

test("a referrer that is a sign-in address is cut to its path", () => {
  const clean = sanitizeAnalyticsUrls({ $referrer: SIGN_IN_URL });
  assert.equal(clean.$referrer, "https://tryluke.dev/sign-in.html");
});

test("any page's address loses its credential parameters and keeps the rest", () => {
  const credentials =
    "code=a&state=b&sig=c&signature=d&token=e&access_token=f&id_token=g&refresh_token=h&error=i&error_description=j&code_challenge=k&code_verifier=l";
  const clean = sanitizeAnalyticsUrls({
    $current_url: `https://tryluke.dev/?${credentials}&utm_source=hn&ref=launch`,
    $set_once: { $initial_current_url: `https://tryluke.dev/about.html?code=${AUTH_CODE}` },
  });
  assert.equal(clean.$current_url, "https://tryluke.dev/?utm_source=hn&ref=launch");
  assert.equal(clean.$set_once.$initial_current_url, "https://tryluke.dev/about.html");
});

test("an address with no credential in it is sent exactly as it came", () => {
  const campaign = "https://tryluke.dev/?utm_campaign=spring%20launch&q=a+b#pricing";
  assert.equal(sanitizeAnalyticsUrls({ $current_url: campaign }).$current_url, campaign);
});

test("landing on the home page with a code sends no event that carries it", () => {
  const pageview = captured.find((event) => event.event === "$pageview");
  assert.ok(pageview, "the landing page view was captured");
  expect(pageview.properties.$current_url).toBe("http://localhost:3000/?utm_source=hn");
  expect(pageview.properties.$session_entry_url).toBe("http://localhost:3000/?utm_source=hn");
  const identify = captured.find((event) => event.event === "$identify");
  expect(identify?.$set_once?.$initial_current_url).toBe("http://localhost:3000/?utm_source=hn");
  expect(JSON.stringify(captured)).not.toContain(AUTH_CODE);
});

test("the recorder's addresses lose the code too", () => {
  const maskAddress = posthog.config.session_recording.maskCapturedNetworkRequestFn;
  assert.ok(maskAddress, "the recorder has an address hook");
  const navigation = {
    name: `http://localhost:3000${LANDING_WITH_CODE}`,
    entryType: "navigation",
    startTime: 0,
    duration: 12,
    isInitial: true,
  };
  expect(maskAddress(navigation)).toEqual({
    ...navigation,
    name: "http://localhost:3000/?utm_source=hn",
  });
});

test("a project that switches everything on loads nothing the privacy notice leaves out", () => {
  expect(requestedScripts().filter((name) => name !== "lazy-recorder.js")).toEqual([]);
  expect(sent.filter((url) => url.pathname.startsWith("/flags"))).toEqual([]);
  expect(captured.map((event) => event.event)).not.toContain("$conversations_loaded");
});
