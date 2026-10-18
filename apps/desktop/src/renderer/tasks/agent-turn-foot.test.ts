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
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { LinkWorkspaceProvider } from "@luke/panel/copy-link-item";
import { MemberDirectory } from "@luke/panel/member-directory";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { codingAgentsControl } from "#testing/tasks-control";
import { AgentTab } from "./agent-tab";

/**
 * agent-turn-foot.test.ts -- in an agent's tab, a finished turn's Copy and
 * Copy link stand at its foot, on the line saying how long it worked and
 * after those words, as a sent message's stand on the line under its
 * bubble; a turn still running offers none. Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };

const ACME: Pick<Workspace, "id" | "memberCount"> = { id: "workspace-acme", memberCount: 1 };

const TURN = "turn";

const WORDS = "Fixed the tile.";

function agentOf(status: CodingAgentStatus): CodingAgentSummary {
  return {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Video tile aspect ratio fix",
    createdAt: 1_000,
    status,
    turnId: null,
    brief: CODING_AGENT_BRIEF.PROMPT,
    startedBy: DEAN,
  };
}

const TASK: CodingAgentMessage = {
  id: "task",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "Make the video tile look good at any width." }],
};

/** The agent's turn, saying its words, finished or still running. */
function turn(finished: boolean): CodingAgentMessage {
  return {
    id: TURN,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text: WORDS }],
    startedAt: 2_000,
    ...(finished ? { finishedAt: 80_000 } : undefined),
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  fakeAppBridge({});
});

/** The agent's turn as the tab draws it, over a page of the task and that turn, for an agent of `status`. */
async function drawnTurn(status: CodingAgentStatus): Promise<HTMLElement> {
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: [{ ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER }],
            }
          : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
      ),
  });
  const messages = [TASK, turn(status !== CODING_AGENT_STATUS.RUNNING)];
  // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [agentOf(status)],
    me: DEAN.userId,
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({ messages, cursor: "2:0", status, title: null });
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MemberDirectory, {
          workspace: ACME,
          readerId: DEAN.userId,
          children: createElement(
            LinkWorkspaceProvider,
            { value: "acme" },
            createElement(AgentTab, {
              agent: agentOf(status),
              control,
              shown: true,
              onOpenSubagent: () => undefined,
              onHeld: () => undefined,
            }),
          ),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return (
    container.querySelector<HTMLElement>(`.is-assistant[data-message-id="${TURN}"]`) ??
    assert.fail("the turn is drawn")
  );
}

/** What stands on the line holding the turn's "Worked for", a line of its own under the turn's words, in reading order. */
function footOf(message: HTMLElement): readonly string[] {
  const worked = message.querySelector("[data-worked]") ?? assert.fail("the turn says it worked");
  const line = worked.parentElement ?? assert.fail("the worked line stands in a line");
  assert.notEqual(line, message, "the line is the turn's foot, not the turn itself");
  return [...line.querySelectorAll("[data-worked], button[aria-label]")].map((each) =>
    each.matches("[data-worked]")
      ? (each.querySelector("[data-worked-length]")?.textContent ?? "")
      : (each.getAttribute("aria-label") ?? ""),
  );
}

test("a finished turn's Copy and Copy link stand on its last line, to the right of how long it worked", async () => {
  const message = await drawnTurn(CODING_AGENT_STATUS.COMPLETED);

  assert.deepEqual(footOf(message), ["Worked for 1m 18s", "Copy", "Copy link"]);
});

test("a turn still running offers no Copy, its words not yet whole", async () => {
  const message = await drawnTurn(CODING_AGENT_STATUS.RUNNING);

  assert.ok(message.textContent?.includes(WORDS), "the turn's words so far are drawn");
  assert.equal(message.querySelector('button[aria-label="Copy"]'), null);
});
