// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { SessionReplayBootstrap } from "@luke/gateway/window-session";
import { sessionRecorderLoaded } from "@luke/panel/session-recorder/contract";
import { afterEach, test, vi } from "vitest";
import { webPlatform } from "../src/app/web-platform";

/**
 * A tab the host does not let record, and a build that carries no project
 * key, such as a development server's, load nothing of session replay and
 * send nothing. A file of its own, because the tab that records loads the
 * recorder for the rest of its life.
 */

const requests = vi.hoisted(() => {
  const made: string[] = [];
  globalThis.fetch = async (url) => {
    made.push(String(url));
    return new Response("{}", { status: 200 });
  };
  return made;
});

function bootstrap(permitted: boolean): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true, accountId: "user-1" };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("a tab the host does not let record, or a build without the site's key, loads no recorder and sends nothing", async () => {
  vi.useFakeTimers();
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "phc_test");
  const platform = webPlatform({ recordSurfaceEvent: () => undefined });

  // The host's word is no: a deleted account, until the next sign-in.
  platform.applySessionReplay(bootstrap(false));
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(sessionRecorderLoaded(), false);

  // The host's word is yes, but this build is a development one, or carries no key.
  vi.stubEnv("PROD", false);
  platform.applySessionReplay(bootstrap(true));
  await vi.advanceTimersByTimeAsync(10_000);
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "");
  platform.applySessionReplay(bootstrap(true));
  await vi.advanceTimersByTimeAsync(10_000);

  assert.equal(sessionRecorderLoaded(), false);
  assert.deepEqual(requests, []);
});
