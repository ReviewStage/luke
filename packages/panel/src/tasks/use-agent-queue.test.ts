// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentQueue } from "@repo/features/agent-queue-wire";
import { AGENT_CALL_FAILURE, type AgentQueueAnswerView } from "@repo/features/agent-view";
import {
  AGENT_ATTACHMENT_TYPE,
  type AgentQueueChange,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { pictureNow } from "../picture-query.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry, testQueryClientNow } from "../testing/copy-feedback.js";
import { useAgentPictureDoor } from "./agent-pictures.js";
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer.js";
import {
  type AgentQueueControl,
  type QueueEditing,
  useAgentQueue,
  useQueueEditing,
} from "./use-agent-queue.js";

const ignore = () => undefined;

const roots: Root[] = [];

let held:
  | {
      composer: AgentComposerControl;
      queue: AgentQueueControl;
      editing: QueueEditing;
      page: (queue: AgentQueue | undefined) => void;
    }
  | undefined;

let sent: AgentQueueChange[] = [];
let pictures: (readonly string[] | undefined)[] = [];
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
  const files = useAgentPictureDoor("agent-1");
  held = { composer, queue, editing: useQueueEditing(composer, queue, files), page: setPage };
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

async function answer(with_: AgentQueueAnswerView): Promise<void> {
  await settle();
  const next = owed.shift();
  assert.ok(next, "a change is owed its answer");
  next(with_);
  await settle();
}

const refused: AgentQueueAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

const message = (id: string, text: string) => ({ id, text, queuedBy: "user-1" });

const SHOT = { name: "flow.png", mediaType: AGENT_ATTACHMENT_TYPE.PNG, data: "iVBORw0KGgo=" };
const SHOT_ID = "3c1f5d0e-7a8b-4c9d-9e0f-1a2b3c4d5e6f";
const SPEC = { name: "spec.pdf", mediaType: AGENT_ATTACHMENT_TYPE.PDF, data: "JVBERi0xLjQ=" };

beforeEach(async () => {
  sent = [];
  pictures = [];
  owed = [];
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.AGENTS_QUEUE]: ({ change, pictures: named }) => {
      sent.push(change);
      pictures.push(named);
      return new Promise((resolve) => owed.push(resolve));
    },
    [ACT_KIND.AGENTS_PICTURE]: ({ pictureId }) =>
      Promise.resolve(
        pictureId === SHOT_ID
          ? { contentType: SHOT.mediaType, base64: SHOT.data }
          : { failure: AGENT_CALL_FAILURE.NOT_FOUND },
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
  assert.equal(now().editing.editing, undefined);
  assert.equal(sent.filter((each) => each.change === QUEUE_CHANGE.ADD).length, 0);
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

test("an edit takes the message's files into the box, read as its row draws them, and Save sends the box's words and files as the message", async () => {
  const queued = {
    ...message("m1", "Match this."),
    files: [{ name: SHOT.name, mediaType: SHOT.mediaType, id: SHOT_ID }],
  };
  act(() => now().page({ messages: [queued], revision: 1 }));
  act(() => now().editing.edit(queued));
  await answer({ queue: { messages: [{ ...queued, editing: true }], revision: 2 } });

  assert.deepEqual(now().composer.attachments, [SHOT]);
  act(() => now().composer.setDraft("Match this, smaller."));
  act(() => now().composer.setAttachments((files) => [...files, SPEC]));
  act(() => now().editing.save());
  await settle();

  assert.deepEqual(sent.at(-1), {
    change: QUEUE_CHANGE.EDIT,
    messageId: "m1",
    text: "Match this, smaller.",
    attachments: [SHOT, SPEC],
  });
});

test("a message queued with an image names the id its bytes stand under for the host to draw it by, and once the service answers it under an id of its own, the bytes the box held stand under that too, never read back", async () => {
  act(() => now().page({ messages: [], revision: 1 }));
  act(() => now().composer.setAttachments(() => [SHOT]));
  act(() => now().editing.queue());
  await settle();
  const ready = (id: string | undefined) => {
    assert.ok(id !== undefined, "the file names an id");
    const state = pictureNow(testQueryClientNow(), "agent-1", id);
    return state.kind === PICTURE_STATE.READY ? state.url : state.kind;
  };
  const url = `data:${SHOT.mediaType};base64,${SHOT.data}`;
  const queued = sent.at(-1);
  assert.ok(queued?.change === QUEUE_CHANGE.ADD);
  assert.equal(ready(pictures.at(-1)?.[0]), url);
  const landed = "5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  await answer({
    queue: {
      messages: [
        {
          ...message(queued.id, ""),
          files: [{ name: SHOT.name, mediaType: SHOT.mediaType, id: landed }],
        },
      ],
      revision: 2,
    },
  });

  assert.equal(ready(landed), url);
});
