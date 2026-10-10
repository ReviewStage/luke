// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  type CodingAgentFailure,
  type CodingAgentMessage,
  type CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript";

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function message(id: string, text: string): CodingAgentMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

/** A page as the service answers it. */
function page(
  messages: readonly CodingAgentMessage[],
  cursor: string,
  status: CodingAgentStatus,
  failure?: CodingAgentFailure,
): CodingAgentMessagesAnswerView {
  return {
    messages,
    cursor,
    status,
    ...(failure === undefined ? undefined : { failureReason: failure }),
  };
}

interface Standing {
  status: CodingAgentStatus;
  shown: boolean;
}

/** One held read the test answers when it chooses. */
interface HeldRead {
  after: string;
  answer: (answer: CodingAgentMessagesAnswerView) => void;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * Mounts the hook over a service whose every read is held until the test
 * answers it, so the test sees exactly which reads were asked and when.
 */
function mount(initial: Standing) {
  const reads: HeldRead[] = [];
  const statuses: CodingAgentStatus[] = [];
  let control: AgentTranscriptControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState(initial);
    restand = setHeld;
    control = useAgentTranscript({
      agentId: AGENT,
      status: held.status,
      shown: held.shown,
      read: (_agentId, after) =>
        new Promise((answer) => {
          reads.push({ after, answer });
        }),
      onStatus: (_agentId, status) => {
        statuses.push(status);
        setHeld((was) => ({ ...was, status }));
      },
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return {
    reads,
    statuses,
    control: () => {
      assert.ok(control);
      return control;
    },
    stand: (next: Partial<Standing>) => act(() => restand?.({ ...initial, ...next })),
    /** Answers the newest read with the page given and lets the loop take it. */
    answer: async (answered: CodingAgentMessagesAnswerView) => {
      const read = reads.at(-1);
      assert.ok(read, "a read is out");
      read.answer(answered);
      await settle();
    },
  };
}

test("a running agent's tab reads from the start, reads on from each page's cursor, and stops the moment a page says the agent ended", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, shown: true });
  assert.deepEqual(
    tab.reads.map((read) => read.after),
    [CODING_AGENT_CURSOR_START],
  );
  assert.equal(tab.control().reading, true);

  await tab.answer(
    page([message("a", "Reading the repository.")], "1:1", CODING_AGENT_STATUS.RUNNING),
  );
  assert.deepEqual(
    tab.reads.map((read) => read.after),
    [CODING_AGENT_CURSOR_START, "1:1"],
  );
  assert.equal(tab.control().reading, false);

  // The hold let go with nothing new: the next read starts where this one ended.
  await tab.answer(page([], "1:1", CODING_AGENT_STATUS.RUNNING));
  assert.equal(tab.reads.length, 3);

  // A message heard again is redrawn in place, and a page saying the agent ended ends the loop, with why where it failed.
  assert.equal(tab.control().failure, undefined);
  await tab.answer(
    page(
      [message("a", "Reading the repository. Done.")],
      "1:2",
      CODING_AGENT_STATUS.FAILED,
      CODING_AGENT_FAILURE.MODEL,
    ),
  );
  assert.deepEqual(
    tab.control().messages.map((each) => each.parts),
    [[{ type: "text", text: "Reading the repository. Done." }]],
  );
  assert.equal(tab.control().failure, CODING_AGENT_FAILURE.MODEL);
  assert.deepEqual(tab.statuses, [
    CODING_AGENT_STATUS.RUNNING,
    CODING_AGENT_STATUS.RUNNING,
    CODING_AGENT_STATUS.FAILED,
  ]);
  // The ended agent is read through: one more page, empty, and then nothing.
  assert.equal(tab.reads.length, 4);
  await tab.answer(page([], "1:2", CODING_AGENT_STATUS.FAILED, CODING_AGENT_FAILURE.MODEL));
  await settle();
  assert.equal(tab.reads.length, 4);
});

test("a hidden tab reads nothing, and a tab shown again reads on from where it stood", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, shown: false });
  assert.equal(tab.reads.length, 0);

  await tab.stand({ shown: true });
  assert.equal(tab.reads.length, 1);
  await tab.answer(page([message("a", "Hi")], "1:1", CODING_AGENT_STATUS.RUNNING));
  assert.equal(tab.reads.length, 2);

  // Hidden mid-read: the answer that lands later is not drawn, and nothing is asked again.
  await tab.stand({ shown: false });
  await tab.answer(page([message("b", "More")], "2:1", CODING_AGENT_STATUS.RUNNING));
  assert.equal(tab.reads.length, 2);
  assert.deepEqual(
    tab.control().messages.map((each) => each.id),
    ["a"],
  );

  await tab.stand({ shown: true });
  assert.equal(tab.reads.at(-1)?.after, "1:1");
});

test("an agent that has ended is read through once, page by page, and then left alone", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, shown: true });
  assert.equal(tab.reads.length, 1);

  await tab.answer(page([message("a", "First page")], "5:1", CODING_AGENT_STATUS.COMPLETED));
  assert.equal(tab.reads.length, 2);
  await tab.answer(page([], "5:1", CODING_AGENT_STATUS.COMPLETED));
  await settle();
  assert.equal(tab.reads.length, 2);
  assert.deepEqual(
    tab.control().messages.map((each) => each.id),
    ["a"],
  );
});

test("a read that did not answer ends the loop and says so, and Try again reads on from the same cursor", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, shown: true });
  await tab.answer(page([message("a", "Hi")], "1:1", CODING_AGENT_STATUS.RUNNING));

  await tab.answer({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(tab.control().failed, true);
  assert.equal(tab.reads.length, 2);

  act(() => tab.control().onRetry());
  await settle();
  assert.equal(tab.control().failed, false);
  assert.equal(tab.reads.length, 3);
  assert.equal(tab.reads.at(-1)?.after, "1:1");
});
