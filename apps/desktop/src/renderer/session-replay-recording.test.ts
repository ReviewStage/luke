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

function bootstrap(permitted: boolean): SessionReplayBootstrap {
  return { permitted, appVersion: "1.2.3", accountId: "user-1" };
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
});
