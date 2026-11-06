// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppPlatform } from "@repo/panel/app-platform";
import { sessionRecorderLoaded } from "@repo/panel/session-recorder/contract";
import { afterEach, test, vi } from "vitest";
import { webPlatform } from "../src/app/web-platform";

const requests = vi.hoisted(() => {
  const made: string[] = [];
  globalThis.fetch = async (url) => {
    made.push(String(url));
    return new Response("{}", { status: 200 });
  };
  return made;
});

type SessionReplayBootstrap = Parameters<AppPlatform["applySessionReplay"]>[0];

function bootstrap(permitted: boolean): SessionReplayBootstrap {
  return { permitted, appVersion: "0.18.0", packaged: true, accountId: "user-1" };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("a tab the host does not let record, a Preview's build, or a build without the site's key, loads no recorder and sends nothing", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WEB_DEPLOYMENT", "production");
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "phc_test");
  await import("../src/app/web-session-replay");
  const platform = webPlatform({ recordSurfaceEvent: () => undefined });

  platform.applySessionReplay(bootstrap(false));
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(sessionRecorderLoaded(), false);

  vi.stubGlobal("WEB_DEPLOYMENT", "preview");
  platform.applySessionReplay(bootstrap(true));
  await vi.advanceTimersByTimeAsync(10_000);
  vi.stubGlobal("WEB_DEPLOYMENT", "production");
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "");
  platform.applySessionReplay(bootstrap(true));
  await vi.advanceTimersByTimeAsync(10_000);

  assert.equal(sessionRecorderLoaded(), false);
  assert.deepEqual(requests, []);
});
