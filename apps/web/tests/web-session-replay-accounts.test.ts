// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppPlatform } from "@repo/panel/app-platform";
import posthog, { type CaptureResult } from "posthog-js/dist/module.no-external";
import { afterEach, beforeEach, test, vi } from "vitest";
import { applyWebSessionReplay } from "../src/app/web-session-replay";

vi.hoisted(() => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });
});

const RECORDING_CHANNEL = "app-session-replay";

type SessionReplayBootstrap = Parameters<AppPlatform["applySessionReplay"]>[0];

function signedIn(accountId: string, permitted = true): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true, accountId };
}

function signedOut(permitted = true): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true };
}

const sent: CaptureResult[] = [];

function identifiedAs(accountId: string): CaptureResult | undefined {
  return sent.findLast(
    (event) => event.event === "$identify" && event.properties.distinct_id === accountId,
  );
}

beforeEach(async () => {
  vi.stubGlobal("WEB_DEPLOYMENT", "production");
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "phc_test");
  document.body.innerHTML = "<main><p>words</p></main>";
  await import("../src/app/session-recorder");
  posthog.on("eventCaptured", (event) => sent.push(event));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("a sign-out stops the recording, and a sign-in after it or in place of the account is never joined to the person before", async () => {
  applyWebSessionReplay(signedIn("user-1"));
  await vi.waitFor(() => assert.equal(posthog.get_distinct_id(), "user-1"));

  applyWebSessionReplay(signedOut());
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.notEqual(posthog.get_distinct_id(), "user-1");

  applyWebSessionReplay(signedIn("user-5"));
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-5");
  assert.notEqual(identifiedAs("user-5")?.properties.$anon_distinct_id, "user-1");

  applyWebSessionReplay(signedIn("user-6"));
  assert.equal(posthog.get_distinct_id(), "user-6");
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.notEqual(identifiedAs("user-6")?.properties.$anon_distinct_id, "user-5");
  assert.equal(identifiedAs("user-6")?.properties.platform, "web");
});

test("an account deleted in another tab stands this tab's recording down until it sees a sign-in after the sign-out", async () => {
  applyWebSessionReplay(signedIn("user-7"));
  await vi.waitFor(() => assert.equal(posthog.sessionRecordingStarted(), true));

  const otherTab = new BroadcastChannel(RECORDING_CHANNEL);
  otherTab.postMessage("account-deleted");
  await vi.waitFor(() => assert.equal(posthog.sessionRecordingStarted(), false));
  otherTab.close();

  applyWebSessionReplay(signedIn("user-7"));
  applyWebSessionReplay(signedOut());
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.notEqual(posthog.get_distinct_id(), "user-7");

  applyWebSessionReplay(signedIn("user-8"));
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-8");
  assert.notEqual(identifiedAs("user-8")?.properties.$anon_distinct_id, "user-7");
});

test("an account deleted in this tab is told to every other tab once it lands, and a sign-out or a deletion that failed is told to none", async () => {
  const otherTab = new BroadcastChannel(RECORDING_CHANNEL);
  const heard: unknown[] = [];
  otherTab.addEventListener("message", (event) => heard.push(event.data));
  applyWebSessionReplay(signedIn("user-9"));
  applyWebSessionReplay(signedIn("user-9", false));
  applyWebSessionReplay(signedOut());
  applyWebSessionReplay(signedIn("user-10"));
  applyWebSessionReplay(signedIn("user-10", false));
  applyWebSessionReplay(signedIn("user-10"));
  applyWebSessionReplay(signedIn("user-10", false));
  applyWebSessionReplay(signedOut(false));
  applyWebSessionReplay(signedOut(false));
  await vi.waitFor(() => assert.deepEqual(heard, ["account-deleted"]));
  const settled = new BroadcastChannel(RECORDING_CHANNEL);
  const marker: unknown[] = [];
  otherTab.addEventListener("message", (event) => marker.push(event.data));
  settled.postMessage("settled");
  await vi.waitFor(() => assert.deepEqual(marker, ["settled"]));
  assert.deepEqual(heard, ["account-deleted", "settled"]);
  settled.close();
  otherTab.close();
});

test("a tab already signed out when another tab deletes the account records again at its next sign-in", async () => {
  applyWebSessionReplay(signedIn("user-12"));
  await vi.waitFor(() => assert.equal(posthog.sessionRecordingStarted(), true));
  applyWebSessionReplay(signedOut());
  assert.equal(posthog.sessionRecordingStarted(), false);

  const otherTab = new BroadcastChannel(RECORDING_CHANNEL);
  const heard = Promise.withResolvers<void>();
  otherTab.addEventListener("message", () => heard.resolve());
  const notice = new BroadcastChannel(RECORDING_CHANNEL);
  notice.postMessage("account-deleted");
  notice.close();
  await heard.promise;
  otherTab.close();

  applyWebSessionReplay(signedIn("user-11"));
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-11");
});
