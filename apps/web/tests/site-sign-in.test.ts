// @vitest-environment jsdom
import assert from "node:assert/strict";
import { desktopSessionPageUrl } from "@repo/features/desktop-session-wire";
import { POSTHOG_PROXY } from "@repo/features/posthog-proxy";
import { act } from "react";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

declare global {
  var jsdom: {
    readonly virtualConsole: { on(event: string, listen: (error: Error) => void): void };
  };
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const PROJECT_KEY = "phc_site_sign_in_test";
const TRANSFER_PATH = "/api/auth/electron/transfer-user";
const SESSION_PATH = "/api/auth/get-session";
const DEFAULT_CAPTURE_PATH = `${POSTHOG_PROXY.PATH}/e/`;
const CAPTURE_ENDPOINT = "/i/v0/e/";
const CAPTURE_PATH = `${POSTHOG_PROXY.PATH}${CAPTURE_ENDPOINT}`;
const PROJECT_CONFIG = {
  analytics: { endpoint: CAPTURE_ENDPOINT },
  supportedCompression: ["gzip", "gzip-js"],
} as const;
const CAPTURE_PATHS: ReadonlySet<string> = new Set([DEFAULT_CAPTURE_PATH, CAPTURE_PATH]);
const BEACON_FIELD = "data=";
const ACCOUNT = { id: "account-1", name: "Ada", email: "ada@example.com" };
const STATE = "state-from-the-mac";
const CHALLENGE = "challenge-from-the-mac";
const LOOPBACK = "http://127.0.0.1:4810/callback";

interface SentEvent {
  readonly event: string;
  readonly properties: { readonly distinct_id?: string; readonly $current_url?: string };
  readonly at: number;
}

const timeline: Array<"send" | "leave"> = [];
const sent: SentEvent[] = [];
const reading: Promise<void>[] = [];

function noteSend(url: URL, body: Promise<string>): void {
  const at = timeline.push("send") - 1;
  reading.push(
    body.then((text) => {
      if (url.pathname === CAPTURE_PATH && text.startsWith(BEACON_FIELD)) return;
      const json = text.startsWith(BEACON_FIELD)
        ? Buffer.from(decodeURIComponent(text.slice(BEACON_FIELD.length)), "base64").toString()
        : text;
      const batch: Array<Omit<SentEvent, "at">> = JSON.parse(json).batch;
      sent.push(...batch.map((event) => ({ ...event, at })));
    }),
  );
}

async function sentEvents(): Promise<SentEvent[]> {
  await Promise.all(reading);
  return sent;
}

let sessionAnswers = true;

function hanging(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

function answer(url: URL, signal: AbortSignal | null | undefined): Promise<Response> | Response {
  if (url.pathname === SESSION_PATH && !sessionAnswers) return hanging(signal);
  if (url.pathname === TRANSFER_PATH) {
    return Response.json({ electron_authorization_code: "code-for-the-mac" });
  }
  if (url.pathname === SESSION_PATH) {
    return Response.json({ session: { id: "session-1", userId: ACCOUNT.id }, user: ACCOUNT });
  }
  return Response.json({});
}

async function loadHandOff(): Promise<void> {
  window.history.replaceState(
    null,
    "",
    desktopSessionPageUrl(window.location.origin, {
      state: STATE,
      codeChallenge: CHALLENGE,
      returnTo: LOOPBACK,
    }),
  );
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  vi.resetModules();
  await act(async () => {
    await import("../src/desktop-session");
  });
}

async function openHandOff(): Promise<void> {
  await loadHandOff();
  await vi.waitFor(() => assert.ok(timeline.includes("leave")));
}

beforeAll(() => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", PROJECT_KEY);
  Reflect.set(window, "_POSTHOG_REMOTE_CONFIG", { [PROJECT_KEY]: { config: PROJECT_CONFIG } });
  Object.defineProperty(window.navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, body: Blob) => {
      noteSend(new URL(url, window.location.href), body.text());
      return true;
    },
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (CAPTURE_PATHS.has(url.pathname)) noteSend(url, Promise.resolve(String(init?.body)));
    return answer(url, init?.signal);
  });
  globalThis.jsdom.virtualConsole.on("jsdomError", (error) => {
    if (error.message.includes("navigation")) timeline.push("leave");
  });
});

beforeEach(() => {
  timeline.length = 0;
  sent.length = 0;
  reading.length = 0;
  sessionAnswers = true;
  window.localStorage.clear();
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, "sendBeacon");
  Reflect.deleteProperty(window, "_POSTHOG_REMOTE_CONFIG");
});

test("a sign-in finished on the hand-off is identified and counted before the page leaves", async () => {
  await openHandOff();

  const leftAt = timeline.indexOf("leave");
  const events = await sentEvents();
  const identify = events.find((event) => event.event === "$identify");
  const complete = events.find((event) => event.event === "site:sign_in_complete");
  assert.ok(identify && complete, "the identify and the count were both sent");
  expect(identify.at).toBeLessThan(leftAt);
  expect(complete.at).toBeLessThan(leftAt);
  expect(identify.properties.distinct_id).toBe(ACCOUNT.id);
  expect(complete.properties.distinct_id).toBe(ACCOUNT.id);
  expect(complete.properties.$current_url).toBe("http://localhost:3000/desktop-session");
  expect(JSON.stringify(events)).not.toMatch(
    /state-from-the-mac|challenge-from-the-mac|127\.0\.0\.1(?::|%(?:25)?3A)4810/iu,
  );
});

test("a hand-off whose session read stalls goes on to the Mac at its deadline, uncounted", async () => {
  sessionAnswers = false;
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);

  await loadHandOff();
  await vi.waitFor(() => expect(timeout).toHaveBeenCalled());
  expect(timeline).not.toContain("leave");
  deadline.abort(new DOMException("The deadline passed.", "TimeoutError"));
  await vi.waitFor(() => assert.ok(timeline.includes("leave")));
  timeout.mockRestore();

  const events = await sentEvents();
  expect(events.map((event) => event.event)).not.toContain("site:sign_in_complete");
  expect(events.map((event) => event.event)).not.toContain("$identify");
});

test("a build that counts nothing never holds the hand-off for the session read", async () => {
  sessionAnswers = false;
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", "");

  await openHandOff();
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", PROJECT_KEY);

  expect(await sentEvents()).toEqual([]);
});

test("a session read that answers after the page's own work still counts", async () => {
  window.history.replaceState(null, "", "/consent.html");
  vi.resetModules();
  const { completeSiteSignIn, startSiteAnalytics } = await import("../src/analytics");
  startSiteAnalytics();
  let answerRead: (session: { session: { id: string }; user: typeof ACCOUNT }) => void = () => {};
  const read = new Promise<{ session: { id: string }; user: typeof ACCOUNT }>((resolve) => {
    answerRead = resolve;
  });

  await import("posthog-js");

  const counting = completeSiteSignIn(read);
  await new Promise((resolve) => setTimeout(resolve, 0));
  answerRead({ session: { id: "session-late" }, user: ACCOUNT });
  await counting;

  const counted = (await sentEvents()).filter((event) => event.event === "site:sign_in_complete");
  expect(counted).toHaveLength(1);
});

test("a session that reaches a second page that counts is counted once", async () => {
  window.history.replaceState(null, "", "/consent.html");
  vi.resetModules();
  const { completeSiteSignIn, startSiteAnalytics } = await import("../src/analytics");
  startSiteAnalytics();
  const signedIn = (id: string) => Promise.resolve({ session: { id }, user: ACCOUNT });

  await completeSiteSignIn(signedIn("session-a"));
  await completeSiteSignIn(signedIn("session-a"));
  await completeSiteSignIn(signedIn("session-b"));

  const counted = (await sentEvents()).filter((event) => event.event === "site:sign_in_complete");
  expect(counted).toHaveLength(2);
});
