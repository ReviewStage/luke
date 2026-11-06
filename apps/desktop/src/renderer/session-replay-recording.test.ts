// @vitest-environment jsdom

import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import type { SessionReplayBootstrap } from "@repo/gateway/window-session";
import { CHOICE_SELECT, ChoiceList, useFilePicker } from "@repo/ui";
import { writeWithheldSheet } from "@repo/ui/session-replay-marks";
import { isRecord, jsonRoundTrip, text, valueFromJsonText, type WireValue } from "@repo/wire";
import posthog, { type CaptureResult } from "posthog-js/dist/module.no-external";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { applySessionReplay } from "./session-replay";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const adoptedSheets = new WeakMap<Document, readonly CSSStyleSheet[]>();
Object.defineProperty(Document.prototype, "adoptedStyleSheets", {
  configurable: true,
  get(this: Document) {
    return adoptedSheets.get(this) ?? [];
  },
  set(this: Document, sheets: readonly CSSStyleSheet[]) {
    adoptedSheets.set(this, [...sheets]);
  },
});

const requests = vi.hoisted(() => {
  const made: string[] = [];
  globalThis.fetch = async (url) => {
    made.push(String(url));
    return new Response("{}", { status: 200 });
  };
  return made;
});

const WORDS = [
  "Quarterly",
  "roadmap",
  "feature-branch",
  "Delete",
  "typed-secret",
  "Folder",
  "private-token",
  "acme/launch-plans",
  "thread-9b1c",
  "budget-2027.pdf",
  "workspace-71a2",
  "workspace-8c4d",
  "task-3f0e",
  "task-5a6b",
  "launch-review",
  "thread-04aa",
  "standup-notes",
];

const GZIP_MAGIC = "\u001f\u008b";

const PERSON = { name: "Ada Lovelace", email: "ada@app.test" } as const;

function bootstrap(permitted: boolean, accountId = "user-1"): SessionReplayBootstrap {
  return { permitted, appVersion: "1.2.3", packaged: true, accountId, ...PERSON };
}

function signedOut(permitted: boolean): SessionReplayBootstrap {
  return { permitted, appVersion: "1.2.3", packaged: true };
}

function drawPage(): void {
  document.body.innerHTML = `
    <link rel="stylesheet" href="styles.css" />
    <!-- standup-notes -->
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
      <ul>
        <li class="sidebar-repository" data-motion-key="acme/launch-plans">
          <span id="thread-9b1c" data-thread="thread-9b1c">roadmap</span>
          <label for="thread-9b1c" aria-describedby="thread-9b1c">Folder</label>
        </li>
      </ul>
      <svg>
        <rect name="thread-9b1c" width="8" height="8" />
        <a xlink:href="https://example.test/ticket?token=private-token"><text>roadmap</text></a>
      </svg>
      <data value="thread-9b1c">Folder</data>
    </main>`;
}

function Controls(): React.JSX.Element {
  const picker = useFilePicker({ onFiles: () => undefined });
  return createElement(
    "div",
    null,
    createElement(ChoiceList<string>, {
      legend: "Workspace",
      select: CHOICE_SELECT.ONE,
      options: [
        { value: "workspace-71a2", label: "Folder" },
        { value: "workspace-8c4d", label: "roadmap" },
      ],
      value: ["workspace-8c4d"],
      onChange: () => undefined,
    }),
    createElement(ChoiceList<string>, {
      legend: "Tasks",
      select: CHOICE_SELECT.MANY,
      options: [
        { value: "task-3f0e", label: "Folder" },
        { value: "task-5a6b", label: "roadmap" },
      ],
      value: [],
      onChange: () => undefined,
    }),
    picker.input,
  );
}

async function drawControls(): Promise<void> {
  const host = document.createElement("div");
  document.querySelector("main")?.append(host);
  await act(async () => createRoot(host).render(createElement(Controls)));
}

async function useControls(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLElement>('[role="radio"]')?.click();
    document.querySelector<HTMLElement>('[role="checkbox"]')?.click();
  });
  const picker = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!picker) return;
  Object.defineProperty(picker, "value", {
    configurable: true,
    get: () => "C:\\fakepath\\budget-2027.pdf",
    set: () => undefined,
  });
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

function adoptSheets(): void {
  const own = new CSSStyleSheet();
  own.replaceSync(".own-sheet-rule { margin: 0; }");
  const measuring = new CSSStyleSheet();
  writeWithheldSheet(measuring, "#description-diagram-1 .launch-review > * { font-size: 30px; }");
  const thread = new CSSStyleSheet();
  writeWithheldSheet(thread, "");
  document.adoptedStyleSheets = [own, measuring, thread];
  writeWithheldSheet(thread, '.comment-mark[data-threads~="thread-04aa"] { padding: 1px; }');
}

function usePage(): void {
  const button = document.querySelector("button");
  button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
  vi.unstubAllGlobals();
});

test("the recorder loads before anything records, a stop while it loads holds, and what it records has no words", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("PACKAGED_POSTHOG_PROJECT_API_KEY", "phc_test");
  drawPage();

  const landing = Promise.withResolvers<void>();
  const importRecorder = () => landing.promise;

  applySessionReplay(bootstrap(true), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), false);

  applySessionReplay(bootstrap(false), importRecorder);
  await import("posthog-js/dist/posthog-recorder");
  landing.resolve();
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.deepEqual(requests, []);

  applySessionReplay(bootstrap(true), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), true);

  const sent: CaptureResult[] = [];
  posthog.on("eventCaptured", (event) => sent.push(event));
  usePage();
  await drawControls();
  await useControls();
  adoptSheets();
  await vi.advanceTimersByTimeAsync(10_000);
  const snapshots = jsonRoundTrip(sent.filter((event) => event.event === "$snapshot"));
  const recording = JSON.stringify(snapshots === undefined ? undefined : opened(snapshots));
  for (const tag of ["h1", "a", "button", "input", "div"]) {
    assert.ok(recording.includes(`"tagName":"${tag}"`), tag);
  }
  assert.ok(recording.includes("styles.css"), "the stylesheet's address");
  assert.ok(recording.includes("#file-icon-ts"), "the icon's symbol");
  assert.ok(recording.includes("own-sheet-rule"), "the panel's own adopted sheet");
  for (const word of WORDS) assert.ok(!recording.includes(word), word);
  applySessionReplay(bootstrap(false), importRecorder);
  applySessionReplay(bootstrap(true, "user-4"), importRecorder);
  await vi.advanceTimersByTimeAsync(10_000);
  const identify = sent.find((event) => event.event === "$identify");
  assert.equal(identify?.properties.app_version, "1.2.3");
  assert.equal(identify?.properties.packaged, true);
});

test("a signed-out run records nothing, a sign-in records under the person it names, and a sign-out or a deletion stops it until the next", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("PACKAGED_POSTHOG_PROJECT_API_KEY", "phc_test");
  drawPage();
  await import("posthog-js/dist/posthog-recorder");
  const importRecorder = () => import("posthog-js/dist/posthog-recorder");
  const sent: CaptureResult[] = [];
  posthog.on("eventCaptured", (event) => sent.push(event));

  applySessionReplay(bootstrap(false), importRecorder);
  applySessionReplay(signedOut(true), importRecorder);
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), false);

  applySessionReplay(bootstrap(true, "user-2"), importRecorder);
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-2");
  const identify = sent.findLast(
    (event) => event.event === "$identify" && event.properties.distinct_id === "user-2",
  );
  assert.deepEqual(identify?.$set, {
    name: "Ada Lovelace",
    email: "ada@app.test",
    platform: "desktop",
  });
  assert.equal(identify?.properties.platform, "desktop");

  applySessionReplay({ ...bootstrap(true, "user-2"), email: "ada@new.app.test" }, importRecorder);
  assert.equal(posthog.get_distinct_id(), "user-2");
  const renamed = sent.findLast((event) => event.event === "$set");
  assert.equal(renamed?.properties.$set?.email, "ada@new.app.test");
  applySessionReplay(
    { ...bootstrap(true, "user-2"), email: "ada@new.app.test", name: undefined },
    importRecorder,
  );
  const unnamed = sent.findLast((event) => event.properties.$unset !== undefined);
  assert.deepEqual(unnamed?.properties.$unset, ["name"]);

  applySessionReplay(signedOut(true), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.notEqual(posthog.get_distinct_id(), "user-2");

  applySessionReplay(bootstrap(true, "user-3"), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), true);
  applySessionReplay(bootstrap(false, "user-3"), importRecorder);
  applySessionReplay(signedOut(false), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), false);
  assert.notEqual(posthog.get_distinct_id(), "user-3");

  applySessionReplay(bootstrap(true, "user-4"), importRecorder);
  assert.equal(posthog.sessionRecordingStarted(), true);
  assert.equal(posthog.get_distinct_id(), "user-4");
});
