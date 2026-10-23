// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { rewindPoints } from "./rewind-action.js";
import { type HeldComposer, useAgentComposer } from "./use-agent-composer.js";

/**
 * A coding agent taken back to an earlier point of its transcript, as its
 * tab offers it: which lines Edit writes again and where each reply's Revert
 * to here drops from, an edit's send taking the agent back before it sends,
 * and a rewind that did not go sending nothing and keeping the edit.
 */

/** A message of the role given, its words its id. */
function message(
  id: string,
  role: typeof MESSAGE_ROLE.USER | typeof MESSAGE_ROLE.ASSISTANT,
  arrivedIn?: CodingAgentMessage["arrivedIn"],
): CodingAgentMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text: id }],
    ...(arrivedIn === undefined ? undefined : { arrivedIn }),
  };
}

/** The plan, two answered lines, and a line a turn took in while it ran. */
const TRANSCRIPT: readonly CodingAgentMessage[] = [
  message("plan", MESSAGE_ROLE.USER),
  message("first-reply", MESSAGE_ROLE.ASSISTANT),
  message("second-line", MESSAGE_ROLE.USER),
  message("second-reply", MESSAGE_ROLE.ASSISTANT),
  message("steer", MESSAGE_ROLE.USER, { journalId: "second-reply", afterStep: 1 }),
  message("third-line", MESSAGE_ROLE.USER),
  message("third-reply", MESSAGE_ROLE.ASSISTANT),
];

test("Edit writes again the lines that opened a turn, and a reply reverts to the next of them", () => {
  const { editable, revertsAt } = rewindPoints(TRANSCRIPT);

  assert.deepEqual([...editable].toSorted(), ["second-line", "third-line"]);
  assert.deepEqual(
    new Map(revertsAt),
    new Map([
      ["first-reply", "second-line"],
      ["second-reply", "third-line"],
    ]),
  );
});

const roots: Root[] = [];

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

/** The agent's box over the transcript, every call it makes written down in order and answered by `rewound`. */
async function box(rewound: CodingAgentAgentAnswer) {
  const calls: string[] = [];
  const held: { composer: HeldComposer | undefined } = { composer: undefined };
  const answered: CodingAgentAgentAnswer = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
  function Box(): ReactNode {
    held.composer = useAgentComposer({
      agentId: "agent-1",
      taskId: "plan-1",
      messages: TRANSCRIPT,
      send: (_agentId, text) => {
        calls.push(`send:${text}`);
        return Promise.resolve(answered);
      },
      rewind: (_agentId, messageId) => {
        calls.push(`rewind:${messageId}`);
        return Promise.resolve(rewound);
      },
      onStatus: () => undefined,
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(Box))));
  const composer = () => {
    if (held.composer === undefined) throw new Error("the box never drew");
    return held.composer;
  };
  return { calls, composer };
}

const REWOUND: CodingAgentAgentAnswer = {
  agent: {
    id: "8f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 0,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  },
};

test("an edit's send takes the agent back to just before the line, then sends the new words", async () => {
  const { calls, composer } = await box(REWOUND);

  await act(async () => composer().edit("second-line", "second-line"));
  await act(async () => composer().setDraft("second line, again"));
  await act(async () => composer().send());
  await settle();

  assert.deepEqual(calls, ["rewind:second-line", "send:second line, again"]);
  assert.equal(composer().editing, undefined);
});

test("a rewind that did not go sends nothing, and the words stand as the edit again", async () => {
  const { calls, composer } = await box({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });

  await act(async () => composer().edit("second-line", "second-line"));
  await act(async () => composer().setDraft("second line, again"));
  await act(async () => composer().send());
  await settle();

  assert.deepEqual(calls, ["rewind:second-line"]);
  assert.equal(composer().editing, "second-line");
  assert.equal(composer().draft, "second line, again");
  assert.equal(composer().cut, undefined);
});

test("a revert hides the line and everything after it until the transcript drops them", async () => {
  const { calls, composer } = await box(REWOUND);

  await act(async () => composer().revert("third-line"));
  await settle();

  assert.deepEqual(calls, ["rewind:third-line"]);
  assert.deepEqual([...(composer().cut ?? [])], ["third-line", "third-reply"]);
});
