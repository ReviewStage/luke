// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppPlatform } from "@luke/panel/app-platform";
import posthog, { type CaptureResult } from "posthog-js/dist/module.no-external";
import { afterEach, beforeEach, test, vi } from "vitest";
import { applyWebSessionReplay } from "../src/app/web-session-replay";

/**
 * A recording follows the account: it is filed under whoever is signed in,
 * under nobody once they leave, and it stops in every tab of the browser
 * when one of them deletes the account, since each tab runs a host of its
 * own that would otherwise go on recording, signed out, after the deletion.
 */

// Nothing leaves the test: every request the client makes is answered here.
vi.hoisted(() => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });
});

/** Where the tabs of a browser tell each other about the recording, as another tab would open it. */
const RECORDING_CHANNEL = "luke-session-replay";

type SessionReplayBootstrap = Parameters<AppPlatform["applySessionReplay"]>[0];

function signedIn(accountId: string, permitted = true): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true, accountId };
}

function signedOut(permitted = true): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true };
}

const sent: CaptureResult[] = [];

/** The `$identify` that filed the recording under `accountId`, last of all. */
function identifiedAs(accountId: string): CaptureResult | undefined {
  return sent.findLast(
    (event) => event.event === "$identify" && event.properties.distinct_id === accountId,
  );
}

beforeEach(async () => {
  vi.stubGlobal("WEB_DEPLOYMENT", "production");
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "phc_test");
  document.body.innerHTML = "<main><p>words</p></main>";
  // The recorder's chunk, already loaded, so the tab's own import of it lands at once.
  await import("../src/app/session-recorder");
  posthog.on("eventCaptured", (event) => sent.push(event));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("a sign-out files what follows under nobody, and a sign-in after it or in place of the account is never joined to the person before", async () => {
  applyWebSessionReplay(signedIn("user-1"));
  await vi.waitFor(() => assert.equal(posthog.get_distinct_id(), "user-1"));

  applyWebSessionReplay(signedOut());
  assert.equal(posthog.sessionRecordingStarted(), true);
  const anonymous = posthog.get_distinct_id();
  assert.notEqual(anonymous, "user-1");

  applyWebSessionReplay(signedIn("user-5"));
  assert.equal(posthog.get_distinct_id(), "user-5");
  assert.equal(identifiedAs("user-5")?.properties.$anon_distinct_id, anonymous);

  // Someone else in place of the account, with no sign-out between.
  applyWebSessionReplay(signedIn("user-6"));
  assert.equal(posthog.get_distinct_id(), "user-6");
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.notEqual(identifiedAs("user-6")?.properties.$anon_distinct_id, "user-5");
  // The build is still named on what is sent after the reset.
  assert.equal(identifiedAs("user-6")?.properties.app_name, "web");
});

test("an account deleted in another tab stands this tab's recording down until it sees a sign-in after the sign-out", async () => {
  applyWebSessionReplay(signedIn("user-7"));
  await vi.waitFor(() => assert.equal(posthog.sessionRecordingStarted(), true));

  const otherTab = new BroadcastChannel(RECORDING_CHANNEL);
  otherTab.postMessage("account-deleted");
  await vi.waitFor(() => assert.equal(posthog.sessionRecordingStarted(), false));
  otherTab.close();

  // This tab's host reads again: first as it stood, then signed out, as the
  // deletion left it. Neither starts it again.
  applyWebSessionReplay(signedIn("user-7"));
  applyWebSessionReplay(signedOut());
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.notEqual(posthog.get_distinct_id(), "user-7");

  // A sign-in in this tab records again, under the account that signed in.
  applyWebSessionReplay(signedIn("user-8"));
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-8");
  assert.notEqual(identifiedAs("user-8")?.properties.$anon_distinct_id, "user-7");
});

test("an account deleted in this tab is told to every other tab", async () => {
  const otherTab = new BroadcastChannel(RECORDING_CHANNEL);
  const heard: unknown[] = [];
  otherTab.addEventListener("message", (event) => heard.push(event.data));
  applyWebSessionReplay(signedIn("user-9"));
  applyWebSessionReplay(signedIn("user-9", false));
  await vi.waitFor(() => assert.deepEqual(heard, ["account-deleted"]));
  otherTab.close();
});
