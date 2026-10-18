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
/** Longer than the recorder waits before it sends what it has buffered. */
const RECORDING_FLUSH_MS = 5_000;
/** The rrweb event type of a recording's page address. */
const RRWEB_META = 4;
/** The rrweb event type of the recorder's own notes, its options among them. */
const RRWEB_CUSTOM = 5;

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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", PROJECT_KEY);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    sent.push(new URL(input instanceof Request ? input.url : String(input)));
    return new Response("{}", { status: 200 });
  });
  window.history.replaceState(null, "", LANDING_WITH_CODE);
  document.body.innerHTML = "<main><h1>Luke</h1></main>";
  Reflect.set(window, "_POSTHOG_REMOTE_CONFIG", { [PROJECT_KEY]: { config: EVERYTHING_ON } });
  // Note that the module reads its key as it loads, so it is loaded afresh
  // under the stubbed key, beside the client it will start. The recorder is
  // the library's own bundle, loaded here because the page would fetch it.
  vi.resetModules();
  await import("posthog-js/dist/lazy-recorder");
  posthog = (await import("posthog-js")).default;
  posthog.on("eventCaptured", (event: CaptureResult) => captured.push(event));
  const { startSiteAnalytics, identifySiteVisitor } = await import("../src/analytics");
  startSiteAnalytics();
  identifySiteVisitor("user-1");
  // The recorder holds its first batch until someone interacts with the page.
  await vi.waitFor(() => assert.ok(captured.some((event) => event.event === "$identify")));
  document.querySelector("h1")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(RECORDING_FLUSH_MS);
});

afterAll(() => {
  vi.useRealTimers();
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

test("a credential in a fragment written as parameters is taken out too", () => {
  const clean = sanitizeAnalyticsUrls({
    $current_url: "https://tryluke.dev/#access_token=secret&token_type=bearer",
    $referrer: "https://tryluke.dev/changelog.html#code",
  });
  assert.equal(clean.$current_url, "https://tryluke.dev/#token_type=bearer");
  assert.equal(clean.$referrer, "https://tryluke.dev/changelog.html#code");
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

/** Every rrweb event the recorder sent, in order. */
function recorded(): { type: number; data: { href?: string; tag?: string; payload?: unknown } }[] {
  return captured
    .filter((event) => event.event === "$snapshot")
    .flatMap((event) => event.properties.$snapshot_data);
}

test("the recording's page address loses the code too", () => {
  const meta = recorded().find((event) => event.type === RRWEB_META);
  assert.ok(meta, "the recorder sent the page's address");
  expect(meta.data.href).toBe("http://localhost:3000/?utm_source=hn");
  expect(JSON.stringify(captured)).not.toContain(AUTH_CODE);
});

test("a recording carries no console, network, or timing, whatever the project says", () => {
  const options = recorded().find(
    (event) => event.type === RRWEB_CUSTOM && event.data.tag === "$session_options",
  );
  assert.ok(options, "the recorder sent its options");
  expect(options.data.payload).toMatchObject({ activePlugins: [] });
});

test("a project that switches everything on loads nothing the privacy notice leaves out", () => {
  expect(requestedScripts()).toEqual([]);
  expect(sent.filter((url) => url.pathname.startsWith("/flags"))).toEqual([]);
  expect(captured.map((event) => event.event)).not.toContain("$conversations_loaded");
});
