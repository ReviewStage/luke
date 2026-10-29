// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AgentQueue, QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { AGENT_CALL_FAILURE, type AgentQueueAnswerView } from "@luke/features/agent-view";
import { type AgentQueueChange, QUEUE_CHANGE } from "@luke/features/agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer.js";
import {
  type AgentQueueControl,
  type QueueEditing,
  useAgentQueue,
  useQueueEditing,
} from "./use-agent-queue.js";

/**
 * An agent's queue as its tab draws and changes it. What it draws is the
 * service's queue, as the newest page or a change's answer names it,
 * whichever stands at the higher revision, so an answer that lands after a
 * newer page never draws an older queue; a message queued and a new order
 * are drawn as they go, and spring back where refused. The
 * message box's part: a message the queue refused comes back into the box,
 * an edit the queue did not save stays open with its new words, an edit of
 * a message the queue would not hold closes, and an edit steered is one
 * change of that message.
 */

const ignore = () => undefined;

const roots: Root[] = [];

/** The tab as it stands after each draw: its box, its queue, and the edit. */
let held:
  | {
      composer: AgentComposerControl;
      queue: AgentQueueControl;
      editing: QueueEditing;
      page: (queue: AgentQueue | undefined) => void;
    }
  | undefined;

/** Every change the tab sent, and the answers still owed, answered in the order a test says. */
let sent: AgentQueueChange[] = [];
let owed: ((answer: AgentQueueAnswerView) => void)[] = [];

function Tab(): ReactNode {
  const [page, setPage] = useState<AgentQueue | undefined>();
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise(ignore),
  });
  const queue = useAgentQueue("agent-1", page);
  held = { composer, queue, editing: useQueueEditing(composer, queue), page: setPage };
  return null;
}

function now(): NonNullable<typeof held> {
  assert.ok(held, "the tab drew");
  return held;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The oldest change still owed its answer, answered now. */
async function answer(with_: AgentQueueAnswerView): Promise<void> {
  // A change waits behind the box's own sends before it is asked, so it is owed once they settle.
  await settle();
  const next = owed.shift();
  assert.ok(next, "a change is owed its answer");
  next(with_);
  await settle();
}

const refused: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

const message = (id: string, text: string) => ({ id, text, queuedBy: "user-1" });

const texts = () => now().queue.messages.map((each) => each.text);

beforeEach(async () => {
  sent = [];
  owed = [];
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.AGENTS_QUEUE]: ({ change }) => {
      sent.push(change);
      return new Promise((resolve) => owed.push(resolve));
    },
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

test("a message queued is drawn at once, and gone once a newer page says it was handed on, whenever its own answer lands", async () => {
  act(() => now().page({ messages: [], revision: 1 }));
  act(() => now().composer.setDraft("Hello"));
  act(() => now().editing.queue());
  assert.deepEqual(texts(), ["Hello"]);

  // The hand-off sent it before the queue's answer to the add came back.
  act(() => now().page({ messages: [], revision: 3 }));
  await answer({ queue: { messages: [message("m1", "Hello")], revision: 2 } });

  assert.deepEqual(texts(), []);
});

test("Resume answered after the page that handed the message on draws neither the message nor the pause", async () => {
  act(() =>
    now().page({
      messages: [message("m1", "Open the pull request")],
      paused: { because: QUEUE_PAUSE.STOPPED },
      revision: 5,
    }),
  );
  act(() => void now().queue.change({ change: QUEUE_CHANGE.RESUME }));

  act(() => now().page({ messages: [], revision: 7 }));
  await answer({ queue: { messages: [message("m1", "Open the pull request")], revision: 6 } });

  assert.deepEqual(texts(), []);
  assert.equal(now().queue.paused, undefined);
});

test("a new order is drawn as the drag drops it, and springs back where the queue refuses it", async () => {
  act(() =>
    now().page({
      messages: [message("m1", "Run tests"), message("m2", "Open the PR")],
      revision: 1,
    }),
  );
  act(() => now().queue.move(1, 0));
  assert.deepEqual(texts(), ["Open the PR", "Run tests"]);

  await answer(refused);

  assert.deepEqual(texts(), ["Run tests", "Open the PR"]);
});

test("a message the queue refused comes back into the box it was queued from", async () => {
  act(() => now().composer.setDraft("Please update the tests"));
  act(() => now().editing.queue());
  await answer(refused);

  assert.equal(now().composer.draft, "Please update the tests");
});

test("an edit the queue refused to save stays open with its new words, the box's own still kept aside", async () => {
  act(() => now().page({ messages: [message("m1", "Run tests")], revision: 1 }));
  act(() => now().composer.setDraft("my own words"));
  act(() => now().editing.edit(message("m1", "Run tests")));
  await answer({ queue: { messages: [message("m1", "Run tests")], revision: 2 } });
  act(() => now().composer.setDraft("Run tests and fix failures"));
  act(() => now().editing.save());
  await answer(refused);

  assert.equal(now().editing.editing, "m1");
  assert.equal(now().composer.draft, "Run tests and fix failures");
  act(() => now().editing.cancel());
  assert.equal(now().composer.draft, "my own words");
});

test("an edit of a message the queue would not hold, already on its way, closes and gives the box back", async () => {
  act(() => now().composer.setDraft("my own words"));
  act(() => now().editing.edit(message("m1", "Run tests")));
  await answer(refused);

  assert.equal(now().editing.editing, undefined);
  assert.equal(now().composer.draft, "my own words");
});

test("an edit steered is one change of the message it edits, with its new words, and nothing sent beside it", async () => {
  act(() => now().page({ messages: [message("m1", "Run tests")], revision: 1 }));
  act(() => now().editing.edit(message("m1", "Run tests")));
  await answer({ queue: { messages: [message("m1", "Run tests")], revision: 2 } });
  act(() => now().composer.setDraft("Run tests and fix failures"));
  act(() => now().editing.steer());
  await settle();

  assert.deepEqual(sent.at(-1), {
    change: QUEUE_CHANGE.STEER,
    messageId: "m1",
    text: "Run tests and fix failures",
  });
  await answer({ queue: { messages: [], revision: 3 } });
  assert.deepEqual(texts(), [], "the message steered leaves the queue");
  assert.equal(now().editing.editing, undefined);
  assert.equal(sent.filter((each) => each.change === QUEUE_CHANGE.ADD).length, 0);
});

test("a message queued is drawn once, never beside its own row on a page that lists it before the queue answers", async () => {
  act(() => now().page({ messages: [], revision: 1 }));
  act(() => now().composer.setDraft("Hello"));
  act(() => now().editing.queue());
  await settle();
  const [added] = sent;
  assert.ok(added?.change === QUEUE_CHANGE.ADD);

  act(() =>
    now().page({
      messages: [{ ...message("m1", "Hello"), clientKey: added.clientKey }],
      revision: 2,
    }),
  );

  assert.deepEqual(texts(), ["Hello"]);
});

test("an edit whose message left the queue, sent or deleted elsewhere, closes and keeps its words in the box", async () => {
  act(() => now().page({ messages: [message("m1", "Run tests")], revision: 1 }));
  act(() => now().editing.edit(message("m1", "Run tests")));
  await answer({ queue: { messages: [message("m1", "Run tests")], revision: 2 } });
  act(() => now().composer.setDraft("Run tests and fix failures"));

  act(() => now().page({ messages: [], revision: 3 }));

  assert.equal(now().editing.editing, undefined);
  assert.equal(now().composer.draft, "Run tests and fix failures");
});
