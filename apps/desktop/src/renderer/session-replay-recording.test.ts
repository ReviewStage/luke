// @vitest-environment jsdom

import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import type { SessionReplayBootstrap } from "@luke/gateway/window-session";
import { isRecord, jsonRoundTrip, text, valueFromJsonText, type WireValue } from "@luke/wire";
import posthog, { type CaptureResult } from "posthog-js/dist/module.no-external";
import { afterEach, test, vi } from "vitest";
import { applySessionReplay } from "./session-replay";

/**
 * The recorder is a bundle of its own that session replay loads before it
 * loads and starts the client, itself a chunk of its own
 * (`session-recorder/contract.ts`), so the masking `init` is given has to
 * reach a recorder that arrived after the panel's bundle, and a stop that
 * arrives while they load has to hold. This runs the
 * library's own client and recorder over a page of words, through the
 * module's public door, and reads what the recording would send.
 */

// Nothing leaves the test: every request the client makes is answered here.
// Stubbed before the client is imported, because it keeps the `fetch` it
// found as it loaded.
const requests = vi.hoisted(() => {
  const made: string[] = [];
  globalThis.fetch = async (url) => {
    made.push(String(url));
    return new Response("{}", { status: 200 });
  };
  return made;
});

/** Words the page draws or is typed into it, none of which may leave in a recording. */
const WORDS = [
  "Quarterly",
  "roadmap",
  "feature-branch",
  "Delete",
  "typed-secret",
  "Folder",
  "private-token",
];

/** The gzip magic the library opens a compressed snapshot field with, as the binary string it sends. */
const GZIP_MAGIC = "\u001f\u008b";

function bootstrap(permitted: boolean, accountId = "user-1"): SessionReplayBootstrap {
  return { permitted, appVersion: "1.2.3", packaged: true, accountId };
}

/** The same run's word on recording with nobody signed in. */
function signedOut(permitted: boolean): SessionReplayBootstrap {
  return { permitted, appVersion: "1.2.3", packaged: true };
}

function drawPage(): void {
  document.body.innerHTML = `
    <link rel="stylesheet" href="styles.css" />
    <main>
      <h1>Quarterly roadmap</h1>
      <a href="https://example.test/invite?token=private-token">roadmap</a>
      <svg><use href="#file-icon-ts" /></svg>
      <p title="feature-branch" aria-label="Folder">feature-branch</p>
      <button type="button">Delete</button>
      <input value="typed-secret" placeholder="Folder" />
      <div contenteditable="true" role="textbox" aria-placeholder="Delete">
        <p>typed-secret <span contenteditable="false" data-chip="skill"><span class="skill-chip">/feature-branch</span></span></p>
      </div>
    </main>`;
}

/** A person using the page: the recorder ships nothing for a page nobody touched. */
function usePage(): void {
  const button = document.querySelector("button");
  button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = document.querySelector("input");
  if (!input) return;
  input.value = "typed-secret, again";
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The recording as rrweb wrote it: the library gzips a full snapshot and a
 * mutation's nodes into binary strings, which would hide a word from a plain
 * search as well as from anyone reading the processor's copy.
 */
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
  vi.unstubAllGlobals();
});

test("the recorder loads before anything records, a stop while it loads holds, and what it records has no words", async () => {
  vi.useFakeTimers();
  // The packaged project key, which esbuild writes into a real build.
  vi.stubGlobal("PACKAGED_POSTHOG_PROJECT_API_KEY", "phc_test");
  drawPage();

  // The recorder's bundle, landing once the test lets it.
  const landing = Promise.withResolvers<void>();
  const importRecorder = () => landing.promise;

  // Recording is wanted, and nothing starts before the recorder's bundle has run.
  applySessionReplay(bootstrap(true), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), false);

  // The account is deleted while it loads: the bundle runs and lands, and
  // nothing starts and nothing is sent.
  applySessionReplay(bootstrap(false), importRecorder);
  await import("posthog-js/dist/posthog-recorder");
  landing.resolve();
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.deepEqual(requests, []);

  // Wanted again, the recorder already there starts at once.
  applySessionReplay(bootstrap(true), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), true);

  const sent: CaptureResult[] = [];
  posthog.on("eventCaptured", (event) => sent.push(event));
  usePage();
  await vi.advanceTimersByTimeAsync(10_000);
  const snapshots = jsonRoundTrip(sent.filter((event) => event.event === "$snapshot"));
  const recording = JSON.stringify(snapshots === undefined ? undefined : opened(snapshots));
  // The page was recorded: its elements are there, by tag.
  for (const tag of ["h1", "a", "button", "input", "div"]) {
    assert.ok(recording.includes(`"tagName":"${tag}"`), tag);
  }
  // A stylesheet's address and an icon's symbol are layout, not words, so the replay can still lay out.
  assert.ok(recording.includes("styles.css"), "the stylesheet's address");
  assert.ok(recording.includes("#file-icon-ts"), "the icon's symbol");
  // And none of its words, in a text node, an attribute, a link's address, an input's value, or
  // an editor's words and chips (the agent's message box, `tasks/composer-field.tsx`).
  for (const word of WORDS) assert.ok(!recording.includes(word), word);
  // A stop resets the client, and the recording a sign-in as someone else
  // resumes still names the build it came from, in the properties the counted
  // events are stamped with, on the events sent beside it: a snapshot itself
  // carries none, so these are what a recording is filtered by.
  applySessionReplay(bootstrap(false), importRecorder);
  applySessionReplay(bootstrap(true, "user-4"), importRecorder);
  await vi.advanceTimersByTimeAsync(10_000);
  const identify = sent.find((event) => event.event === "$identify");
  assert.equal(identify?.properties.app_version, "1.2.3");
  assert.equal(identify?.properties.packaged, true);
});

test("a sign-in partway through a recording files it under the account, and one after a deletion records again", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("PACKAGED_POSTHOG_PROJECT_API_KEY", "phc_test");
  drawPage();
  // The recorder's bundle, already run, so it lands at once however this test is ordered.
  await import("posthog-js/dist/posthog-recorder");
  const importRecorder = () => import("posthog-js/dist/posthog-recorder");
  const sent: CaptureResult[] = [];
  posthog.on("eventCaptured", (event) => sent.push(event));

  // Whatever ran before, a sign-out stands it down, and recording starts again signed out.
  applySessionReplay(bootstrap(false), importRecorder);
  applySessionReplay(signedOut(true), importRecorder);
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), true);
  const anonymous = posthog.get_distinct_id();
  assert.notEqual(anonymous, "user-2");

  // The sign-in lands while it records: recording is still permitted, and only the account moved.
  applySessionReplay(bootstrap(true, "user-2"), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-2");
  // The anonymous stretch before it is joined to the person, so erasing the account reaches it.
  const identify = sent.find((event) => event.event === "$identify");
  assert.equal(identify?.properties.$anon_distinct_id, anonymous);

  // The account is deleted: the halt and then the host's answer stand recording down.
  applySessionReplay(bootstrap(false, "user-2"), importRecorder);
  applySessionReplay(signedOut(false), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.notEqual(posthog.get_distinct_id(), "user-2");

  // A later sign-in in the same run records again, filed under the account that signed in.
  applySessionReplay(bootstrap(true, "user-3"), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-3");
});
