// @vitest-environment jsdom

import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import type { AppPlatform } from "@repo/panel/app-platform";
import { isRecord, jsonRoundTrip, text, valueFromJsonText, type WireValue } from "@repo/wire";
import posthog, { type CaptureResult } from "posthog-js/dist/module.no-external";
import { afterEach, test, vi } from "vitest";
import { webPlatform } from "../src/app/web-platform";

vi.hoisted(() => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });
});

const WORDS = [
  "elsewhere.example",
  "Quarterly",
  "roadmap",
  "feature-branch",
  "typed-secret",
  "acme",
  "plan-123",
  "secret-code",
];

const GZIP_MAGIC = "\u001f\u008b";

type SessionReplayBootstrap = Parameters<AppPlatform["applySessionReplay"]>[0];

function bootstrap(permitted: boolean): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true, accountId: "user-1" };
}

function drawPage(): void {
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

function usePage(): void {
  document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = document.querySelector("input");
  if (!input) return;
  input.value = "typed-secret, again";
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

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
  vi.unstubAllGlobals();
});

test("a production build with the site's key records the tab under the desktop's masking, nothing of its words or its address leaves, and a stop leaves the site's own counting alone", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WEB_DEPLOYMENT", "production");
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "phc_test");
  drawPage();
  document.title = "Quarterly roadmap";
  Object.defineProperty(document, "referrer", {
    value: "https://elsewhere.example/thread?from=feature-branch",
    configurable: true,
  });
  await import("../src/app/session-recorder");
  await import("../src/app/web-session-replay");
  const platform = webPlatform({ recordSurfaceEvent: () => undefined });
  const sent: CaptureResult[] = [];
  posthog.on("eventCaptured", (event) => sent.push(event));

  platform.applySessionReplay(bootstrap(true));
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), true);

  const recording = posthog.config.session_recording;
  assert.equal(recording.captureCanvas?.recordCanvas, false);
  assert.equal(posthog.config.autocapture, false);
  assert.equal(posthog.config.enable_recording_console_log, false);
  assert.equal(posthog.config.capture_performance, false);
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
  const everything = JSON.stringify(sent.map((event) => event.properties));
  for (const word of WORDS) {
    assert.ok(!recorded.includes(word), word);
    assert.ok(!everything.includes(word), word);
  }
  const identify = sent.find((event) => event.event === "$identify");
  assert.equal(identify?.properties.app_name, "web");
  assert.equal(identify?.properties.$current_url, `${location.origin}/app`);

  posthog.capture("probe", {
    here: `${location.origin}/acme/plan/plan-123`,
    elsewhere: `${location.origin}.example.test/page`,
  });
  const probe = sent.find((event) => event.event === "probe");
  assert.equal(probe?.properties.here, `${location.origin}/app`);
  assert.equal(probe?.properties.elsewhere, `${location.origin}.example.test/page`);

  localStorage.setItem("ph_phc_test_posthog", '{"distinct_id":"site-visitor"}');
  platform.applySessionReplay({ ...bootstrap(false), accountId: undefined });
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.equal(localStorage.getItem("__ph_opt_in_out_phc_test"), null);
  assert.equal(localStorage.getItem("ph_phc_test_posthog"), '{"distinct_id":"site-visitor"}');
});
