// @vitest-environment jsdom

import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import type { AppPlatform } from "@luke/panel/app-platform";
import { isRecord, jsonRoundTrip, text, valueFromJsonText, type WireValue } from "@luke/wire";
import posthog, { type CaptureResult } from "posthog-js/dist/module.no-external";
import { afterEach, test, vi } from "vitest";
import { webPlatform } from "../src/app/web-platform";

/**
 * The web app records what the desktop's panel window records, through the
 * same controller and the same masking (`@luke/panel/session-replay`). This
 * runs the library's own client and recorder over a page of words, through
 * the tab's platform door as the panel calls it, and reads the client's
 * configuration and what the recording would send.
 */

// Nothing leaves the test: every request the client makes is answered here.
// Stubbed before the client is imported, because it keeps the `fetch` it
// found as it loaded.
vi.hoisted(() => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });
});

/** Words the page draws, or the tab's address carries, none of which may leave in a recording. */
const WORDS = [
  "Quarterly",
  "roadmap",
  "feature-branch",
  "typed-secret",
  "acme",
  "plan-123",
  "secret-code",
];

/** The gzip magic the library opens a compressed snapshot field with, as the binary string it sends. */
const GZIP_MAGIC = "\u001f\u008b";

/** The host's word on recording, as the panel hands it to the platform. */
type SessionReplayBootstrap = Parameters<AppPlatform["applySessionReplay"]>[0];

function bootstrap(permitted: boolean): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true, accountId: "user-1" };
}

function drawPage(): void {
  // The tab at a task's link, with a query a sign-in might have left on it.
  history.replaceState(null, "", "/acme/plan/plan-123?code=secret-code");
  document.body.innerHTML = `
    <meta name="description" content="Quarterly roadmap" />
    <link rel="stylesheet" href="/assets/app.css" />
    <main>
      <h1 title="feature-branch">Quarterly roadmap</h1>
      <a href="/acme/plan/plan-123">roadmap</a>
      <button type="button" aria-label="feature-branch">Delete</button>
      <input value="typed-secret" placeholder="roadmap" />
    </main>`;
}

/** A person using the page: the recorder ships nothing for a page nobody touched. */
function usePage(): void {
  document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = document.querySelector("input");
  if (!input) return;
  input.value = "typed-secret, again";
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The recording as rrweb wrote it, its gzipped snapshot fields opened. */
function opened(value: WireValue): WireValue {
  const asText = text(value);
  if (asText !== undefined) {
    return asText.startsWith(GZIP_MAGIC)
      ? valueFromJsonText(gunzipSync(Buffer.from(asText, "latin1")).toString("utf8"))
      : value;
  }
  if (Array.isArray(value)) return value.map(opened);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, opened(entry)]));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("a production build with the site's key records the tab under the desktop's masking, nothing of its words or its address leaves, and a stop leaves the site's own counting alone", async () => {
  vi.useFakeTimers();
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "phc_test");
  drawPage();
  // The recorder's chunk, already run, so the tab's own import of it lands at once.
  await import("../src/app/session-recorder");
  // The recording's chunk, already loaded, so the tab's own import of it lands at once.
  await import("../src/app/web-session-replay");
  const platform = webPlatform({ recordSurfaceEvent: () => undefined });
  const sent: CaptureResult[] = [];
  posthog.on("eventCaptured", (event) => sent.push(event));

  platform.applySessionReplay(bootstrap(true));
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), true);

  // What the recorder was started with: every text node and input masked,
  // the canvas, the console, and clicks kept out, and the attributes that
  // carry words asterisked while a stylesheet's address still lays out.
  const recording = posthog.config.session_recording;
  assert.equal(recording.maskTextSelector, "*");
  assert.equal(recording.captureCanvas?.recordCanvas, false);
  assert.equal(posthog.config.mask_all_text, true);
  assert.equal(posthog.config.autocapture, false);
  assert.equal(posthog.config.enable_recording_console_log, false);
  const link = document.createElement("link");
  assert.equal(recording.maskAttributeFn?.("title", "roadmap", link), "*******");
  assert.equal(recording.maskAttributeFn?.("href", "/assets/app.css", link), "/assets/app.css");
  assert.equal(recording.maskAttributeFn?.("href", "/x", document.createElement("a")), "**");

  usePage();
  await vi.advanceTimersByTimeAsync(10_000);
  const snapshots = jsonRoundTrip(sent.filter((event) => event.event === "$snapshot"));
  const recorded = JSON.stringify(snapshots === undefined ? undefined : opened(snapshots));
  for (const tag of ["h1", "a", "button", "input"]) {
    assert.ok(recorded.includes(`"tagName":"${tag}"`), tag);
  }
  // Every event says the tab is at the app's own address, and is filed as the web's.
  const everything = JSON.stringify(sent.map((event) => event.properties));
  for (const word of WORDS) {
    assert.ok(!recorded.includes(word), word);
    assert.ok(!everything.includes(word), word);
  }
  const identify = sent.find((event) => event.event === "$identify");
  assert.equal(identify?.properties.app_name, "web");
  assert.equal(identify?.properties.$current_url, `${location.origin}/app`);

  // An account deleted stands the recording down, and leaves the site's own
  // counting of the same project, which shares this origin's storage, as it was:
  // neither opted out nor reset.
  localStorage.setItem("ph_phc_test_posthog", '{"distinct_id":"site-visitor"}');
  platform.applySessionReplay({ ...bootstrap(false), accountId: undefined });
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.equal(localStorage.getItem("__ph_opt_in_out_phc_test"), null);
  assert.equal(localStorage.getItem("ph_phc_test_posthog"), '{"distinct_id":"site-visitor"}');
});
