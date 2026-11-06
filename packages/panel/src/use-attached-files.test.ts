// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentAgentAnswer } from "@repo/features/agent-view";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { FAILURE_SURFACE, type ShownFailureReport } from "@repo/features/shown-failure";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { installShownFailureReporter } from "./failure-report.js";
import { AgentComposer } from "./tasks/agent-composer.js";
import { useAgentComposer } from "./tasks/use-agent-composer.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { attachmentChipName } from "./testing/attachment-chip.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  QUIET_COMPOSER,
} from "./testing/composer.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { installScrollIntoView } from "./testing/scroll-into-view.js";

const ignore = () => undefined;

function AgentBox(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise<AgentAgentAnswer>(ignore),
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, composer, skills: undefined });
}

function QueueingBox(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise<AgentAgentAnswer>(ignore),
  });
  const queued = () => {
    composer.setDraft("");
    composer.setAttachments(() => []);
  };
  return createElement(AgentComposer, {
    ...QUIET_COMPOSER,
    composer,
    skills: undefined,
    queueing: {
      working: true,
      enterQueues: true,
      onQueue: queued,
      editing: false,
      onSave: ignore,
      onSteer: ignore,
      onCancel: ignore,
    },
  });
}

const BOXES = {
  agent: () => createElement(AgentBox),
} as const;

function png(name: string, size = 8): File {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes], name, { type: "image/png" });
}

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

async function read(): Promise<void> {
  for (let round = 0; round < 16; round += 1) await settle();
}

async function mounted(box: keyof typeof BOXES): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), BOXES[box]())));
  await settle();
  return container;
}

async function drop(container: HTMLElement, files: readonly File[]): Promise<void> {
  const card = container.querySelector(".agent-composer") ?? assert.fail("no card");
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
  act(() => card.dispatchEvent(event));
  await read();
}

async function paste(container: HTMLElement, files: readonly File[]): Promise<boolean> {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, types: ["Files"], getData: () => "" },
  });
  act(() => {
    composerEditor(container).dispatchEvent(event);
  });
  await read();
  return !event.defaultPrevented;
}

function held(container: HTMLElement) {
  return {
    chips: [...container.querySelectorAll('[aria-label="Attached files"] > li')].map(
      attachmentChipName,
    ),
    note: container.querySelector('.ui-composer-foot-note [role="alert"]')?.textContent ?? null,
  };
}

test("a picture dropped on the agent's box is held as its chip, and says nothing", async () => {
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    await drop(container, [png("dropped.png")]);
    assert.deepEqual(held(container), { chips: ["dropped.png"], note: null }, box);
  }
});

test("a picture pasted into the agent's box is held as its chip, the paste writing no words", async () => {
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    assert.equal(await paste(container, [png("pasted.png")]), false, `${box} takes the paste`);
    assert.deepEqual(held(container), { chips: ["pasted.png"], note: null }, box);
    assert.equal(composerEditor(container).textContent, "", `${box} writes no words`);
  }
});

test("a file this machine cannot read says so in the agent's box and is reported with why", async () => {
  const reports: ShownFailureReport[] = [];
  const uninstall = installShownFailureReporter((report) => {
    reports.push(report);
    return undefined;
  });
  const unreadable = new DOMException("The file could not be read.", "NotReadableError");
  const file = Object.assign(new File(["notes"], "notes.txt", { type: "text/plain" }), {
    arrayBuffer: () => Promise.reject(unreadable),
  });
  const container = await mounted("agent");

  await drop(container, [file]);
  uninstall();

  assert.deepEqual(held(container), { chips: [], note: "notes.txt couldn't be read." });
  assert.deepEqual(
    reports.map((report) => [report.surface, report.cause]),
    [[FAILURE_SURFACE.ATTACHMENT_READ, unreadable]],
  );
});

test("pictures past the bytes a message carries together leave the last out of the agent's box, and the note says why", async () => {
  const size = Math.floor(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES / 2.5);
  assert.ok(size <= AGENT_BOUNDS.MAX_IMAGE_BYTES);
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    await drop(container, [png("one.png", size), png("two.png", size), png("three.png", size)]);
    assert.deepEqual(
      held(container),
      {
        chips: ["one.png", "two.png"],
        note: "These files are too large to send together.",
      },
      box,
    );
  }
});

test("a note of files left out goes once the box's message is queued, as it goes once one is sent", async () => {
  const size = Math.floor(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES / 2.5);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(QueueingBox))));
  await settle();
  await drop(container, [png("one.png", size), png("two.png", size), png("three.png", size)]);
  assert.equal(held(container).note, "These files are too large to send together.");

  const queue = container.querySelector('button[aria-label="Queue"]');
  assert.ok(queue instanceof HTMLButtonElement, "Send reads Queue while the turn runs");
  act(() => queue.click());
  await settle();

  assert.deepEqual(held(container), { chips: [], note: null });
});
