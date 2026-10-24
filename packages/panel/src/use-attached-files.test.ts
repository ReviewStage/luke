// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAgentAnswer } from "@luke/features/coding-agent-view";
import { CODING_AGENT_BOUNDS } from "@luke/features/coding-agent-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { AgentComposer } from "./tasks/agent-composer.js";
import { ChatComposer, type ChatComposerMentions } from "./tasks/chat-composer.js";
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

/**
 * The agent's box and a channel's box take files one way: a picture
 * dropped on the card or pasted into the field is held as its chip, and
 * pictures past the bytes a message carries together are left out, the box
 * saying why in its note while the ones that fit still come.
 */

const ignore = () => undefined;

/** A channel's box standing alone: no member, no task, and no channel to mention. */
const NO_MENTIONS: ChatComposerMentions = {
  source: { taskId: "", taskName: "", workspace: "", repository: null, text: () => "" },
  members: { people: [], agents: [] },
  channels: [],
  crowded: () => false,
};

/** The agent's box on its own control, whose sends never answer. */
function AgentBox(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise<CodingAgentAgentAnswer>(ignore),
    onStatus: ignore,
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, composer, skills: undefined });
}

/** The boxes that take files, each drawn alone. */
const BOXES = {
  agent: () => createElement(AgentBox),
  chat: () =>
    createElement(ChatComposer, {
      channelId: "c0a1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b",
      label: "Message #general",
      mentions: NO_MENTIONS,
      keywords: [],
      onSend: ignore,
    }),
} as const;

/** A PNG's signature, and bytes past it to give the picture its size. */
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

/** Lets files handed to a box be read off the disk, each read taking a few of the event loop's turns, one file after another. */
async function read(): Promise<void> {
  for (let round = 0; round < 16; round += 1) await settle();
}

/** The box drawn, its editor landed. */
async function mounted(box: keyof typeof BOXES): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), BOXES[box]())));
  await settle();
  return container;
}

/** Files dropped on the box's card, and read off the disk before they land. */
async function drop(container: HTMLElement, files: readonly File[]): Promise<void> {
  const card = container.querySelector(".agent-composer") ?? assert.fail("no card");
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
  act(() => card.dispatchEvent(event));
  await read();
}

/** Files pasted into the box's editor, as the clipboard hands a screenshot over; answers whether the editor let the paste go by. */
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

/** What the box shows of its files: its chips by name, and its note. */
function held(container: HTMLElement) {
  return {
    chips: [...container.querySelectorAll('[aria-label="Attached files"] > li')].map(
      attachmentChipName,
    ),
    note:
      container.querySelector(
        '.agent-composer-note [role="alert"], .luke-composer-foot-note [role="alert"]',
      )?.textContent ?? null,
  };
}

test("a picture dropped on the agent's box and on a channel's box is held as its chip, and says nothing", async () => {
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    await drop(container, [png("dropped.png")]);
    assert.deepEqual(held(container), { chips: ["dropped.png"], note: null }, box);
  }
});

test("a picture pasted into the agent's box and into a channel's box is held as its chip, the paste writing no words", async () => {
  for (const box of Object.keys(BOXES) as (keyof typeof BOXES)[]) {
    const container = await mounted(box);
    assert.equal(await paste(container, [png("pasted.png")]), false, `${box} takes the paste`);
    assert.deepEqual(held(container), { chips: ["pasted.png"], note: null }, box);
    assert.equal(composerEditor(container).textContent, "", `${box} writes no words`);
  }
});

test("pictures past the bytes a message carries together leave the last out of the agent's box and a channel's box alike, and the note says why", async () => {
  // Note that each picture fits a message alone, kept as it is, and two of them fit together while three do not.
  const size = Math.floor(CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES / 2.5);
  assert.ok(size <= CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES);
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
