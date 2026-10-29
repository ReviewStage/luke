// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { QUEUE_CHANGE } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer.js";
import { type QueueEditing, useAgentQueue, useQueueEditing } from "./use-agent-queue.js";

/**
 * The message box's part in an agent's queue when the queue refuses it: a
 * message the queue did not take comes back into the box, an edit the
 * queue did not save stays open with its new words, so a refusal never
 * loses what was typed, and an edit of a message the queue would not hold,
 * already on its way, closes and gives the box back.
 */

const ignore = () => undefined;

const roots: Root[] = [];

/** The box and its queue as the tab holds them, read after each draw. */
let held: { composer: AgentComposerControl; editing: QueueEditing } | undefined;

function Tab(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise(ignore),
    onStatus: ignore,
  });
  const queue = useAgentQueue("agent-1", undefined);
  held = { composer, editing: useQueueEditing(composer, queue) };
  return null;
}

function now(): { composer: AgentComposerControl; editing: QueueEditing } {
  assert.ok(held, "the tab drew");
  return held;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The changes the service refuses; it answers every other with an empty queue. */
let refused: ReadonlySet<string> = new Set();

beforeEach(async () => {
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_QUEUE]: ({ change }) =>
      Promise.resolve(
        refused.has(change.change)
          ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
          : { queue: { messages: [] } },
      ),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(Tab))));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  held = undefined;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

test("a message the queue refused comes back into the box it was queued from", async () => {
  refused = new Set([QUEUE_CHANGE.ADD]);
  act(() => now().composer.setDraft("Please update the tests"));
  act(() => now().editing.queue());
  await settle();

  assert.equal(now().composer.draft, "Please update the tests");
});

test("an edit the queue refused to save stays open with its new words, the box's own still kept aside", async () => {
  refused = new Set([QUEUE_CHANGE.EDIT]);
  act(() => now().composer.setDraft("my own words"));
  act(() => now().editing.edit({ id: "m1", text: "Run tests", queuedBy: "user-1" }));
  act(() => now().composer.setDraft("Run tests and fix failures"));
  act(() => now().editing.save());
  await settle();

  assert.equal(now().editing.editing, "m1");
  assert.equal(now().composer.draft, "Run tests and fix failures");
  act(() => now().editing.cancel());
  assert.equal(now().composer.draft, "my own words");
});

test("an edit of a message the queue would not hold, already on its way, closes and gives the box back", async () => {
  refused = new Set([QUEUE_CHANGE.HOLD]);
  act(() => now().composer.setDraft("my own words"));
  act(() => now().editing.edit({ id: "m1", text: "Run tests", queuedBy: "user-1" }));
  await settle();

  assert.equal(now().editing.editing, undefined);
  assert.equal(now().composer.draft, "my own words");
});
