// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSender,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/plans-control";
import { AgentTab } from "./agent-tab";

/**
 * agent-senders.test.ts -- in an agent's tab, a message a teammate sent the
 * agent carries their name over its bubble, as a teammate's line on the Call
 * tab does, and the reader's own carries none; so do Luke's, an automation's,
 * and a former member's, and a message from before senders were kept names
 * nobody. Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.TASK,
  startedBy: DEAN,
};

/** One of the developer's messages, with what sent it where its row kept it. */
function line(id: string, text: string, sentBy?: CodingAgentSender): CodingAgentMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    ...(sentBy === undefined ? undefined : { sentBy }),
  };
}

const MESSAGES: readonly CodingAgentMessage[] = [
  line("task", "Add the invite flow."),
  line("dean", "Use seven days.", DEAN),
  line("charles", "Not five.", CHARLES),
  line("earlier", "Keep the old copy."),
  line("luke", "Rebase on main.", { name: "Luke" }),
  line("automation", "Triage the failures.", { name: "Nightly triage" }),
  line("former", "Drop the banner.", { name: "Former member" }),
];

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Each of the developer's messages as `reader` sees the tab, by its id: the name over it, where one is drawn. */
async function sendersFor(reader: string): Promise<readonly (readonly [string, string | null])[]> {
  // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [AGENT],
    me: reader,
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({
        messages: [...MESSAGES],
        cursor: "7:0",
        status: CODING_AGENT_STATUS.COMPLETED,
        title: null,
      });
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentTab, {
          agent: AGENT,
          control,
          shown: true,
          onOpenSubagent: () => undefined,
          onHeld: () => undefined,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const drawn = [...container.querySelectorAll(".is-user")];
  assert.equal(drawn.length, MESSAGES.length);
  return drawn.map(
    (message, index) =>
      [
        MESSAGES[index]?.id ?? "",
        message.querySelector(".message-sender")?.textContent ?? null,
      ] as const,
  );
}

test("each member sees a teammate's name over the teammate's messages and none over their own, and a message with no sender names nobody", async () => {
  const deanSees = await sendersFor(DEAN.userId);
  act(() => root?.unmount());
  const charlesSees = await sendersFor(CHARLES.userId);

  assert.deepEqual(deanSees, [
    ["task", null],
    ["dean", null],
    ["charles", "Charles Pan"],
    ["earlier", null],
    ["luke", "Luke"],
    ["automation", "Nightly triage"],
    ["former", "Former member"],
  ]);
  assert.deepEqual(charlesSees, [
    // The task is Dean's, whose agent it is, as "Started by" says.
    ["task", "Dean Stratakos"],
    ["dean", "Dean Stratakos"],
    ["charles", null],
    ["earlier", null],
    ["luke", "Luke"],
    ["automation", "Nightly triage"],
    ["former", "Former member"],
  ]);
});
