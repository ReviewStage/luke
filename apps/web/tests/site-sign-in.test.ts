// @vitest-environment jsdom
import assert from "node:assert/strict";
import { desktopSessionPageUrl } from "@luke/features/desktop-session-wire";
import { act } from "react";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

/**
 * site-sign-in.test.ts -- a sign-in the website completes names the visitor
 * by the account it signed in as and counts `site:sign_in_complete`, once
 * per session, and both have left the browser before the desktop's hand-off
 * page sends it on to the Mac. The page runs as the Mac opens it, on the
 * real analytics library; the network, Better Auth's answers, and the
 * browser's beacon are the fakes, and the page leaving is read off jsdom's
 * report that it cannot navigate.
 */

declare global {
  /** The page's own jsdom, which vitest's jsdom environment sets on the global. */
  var jsdom: {
    readonly virtualConsole: { on(event: string, listen: (error: Error) => void): void };
  };
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const PROJECT_KEY = "phc_site_sign_in_test";
const TRANSFER_PATH = "/api/auth/electron/transfer-user";
const SESSION_PATH = "/api/auth/get-session";
const CAPTURE_PATH = "/e/";
const BEACON_FIELD = "data=";
const ACCOUNT = { id: "account-1", name: "Ada", email: "ada@example.com" };
const STATE = "state-from-the-mac";
const CHALLENGE = "challenge-from-the-mac";
const LOOPBACK = "http://127.0.0.1:4810/callback";

/** One event as it left the browser, and where in `timeline` the request carrying it went. */
interface SentEvent {
  readonly event: string;
  readonly properties: { readonly distinct_id?: string; readonly $current_url?: string };
  readonly at: number;
}

/** What left the page, in order: each request carrying events, and the page leaving. */
const timeline: Array<"send" | "leave"> = [];
const sent: SentEvent[] = [];
/** Decodes still under way, since a beacon's Blob is read asynchronously. */
const reading: Promise<void>[] = [];

/**
 * Notes a request to the capture endpoint, and its events once its body is
 * read: a batch's JSON, which a beacon carries as base64 form data.
 */
function noteSend(body: Promise<string>): void {
  const at = timeline.push("send") - 1;
  reading.push(
    body.then((text) => {
      const json = text.startsWith(BEACON_FIELD)
        ? Buffer.from(decodeURIComponent(text.slice(BEACON_FIELD.length)), "base64").toString()
        : text;
      const batch: Array<Omit<SentEvent, "at">> = JSON.parse(json).batch;
      sent.push(...batch.map((event) => ({ ...event, at })));
    }),
  );
}

/** Every event sent so far, once each request's body has been read. */
async function sentEvents(): Promise<SentEvent[]> {
  await Promise.all(reading);
  return sent;
}

/** Whether Better Auth answers the session read, or leaves it hanging until its deadline. */
let sessionAnswers = true;

/** A request that never answers, failing as fetch does once its signal aborts. */
function hanging(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

/** Better Auth's answers, by path; the analytics endpoints answer an empty object. */
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

/** The hand-off page as the Mac opens it, loaded but not yet run to its end. */
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

/** The hand-off page as the Mac opens it, run until it leaves for the loopback. */
async function openHandOff(): Promise<void> {
  await loadHandOff();
  await vi.waitFor(() => assert.ok(timeline.includes("leave")));
}

beforeAll(() => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_API_KEY", PROJECT_KEY);
  Object.defineProperty(window.navigator, "sendBeacon", {
    configurable: true,
    value: (_url: string, body: Blob) => {
      noteSend(body.text());
      return true;
    },
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.pathname === CAPTURE_PATH) noteSend(Promise.resolve(String(init?.body)));
    return answer(url, init?.signal);
  });
  // Note that jsdom does not navigate: it reports each attempt on its own
  // console, which the environment exposes as `jsdom`.
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
  expect(complete.properties.$current_url).toBe("http://localhost:3000/desktop-session.html");
  // Note that the loopback's port is matched only after its host, plain or escaped, because a random id may hold its digits.
  expect(JSON.stringify(events)).not.toMatch(
    /state-from-the-mac|challenge-from-the-mac|127\.0\.0\.1(?::|%(?:25)?3A)4810/iu,
  );
});

test("a hand-off whose session read stalls goes on to the Mac at its deadline, uncounted", async () => {
  sessionAnswers = false;
  // The read's deadline is the clock this page reads, so the test holds it.
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
  // A turn of the event loop, so the count is already waiting on the read.
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
