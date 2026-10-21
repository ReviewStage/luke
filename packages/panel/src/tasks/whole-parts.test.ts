// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentPartParams,
  type CodingAgentPartView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
  PART_CUT_FIELD,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { codingAgentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";

/**
 * whole-parts.test.ts -- a command's output and a thought its page carried
 * cut are drawn closed as any other, read whole only once their fold opens,
 * and drawn whole under it once read, the wait said while the read is under
 * way. Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };

const ACME: Pick<Workspace, "id" | "memberCount"> = { id: "workspace-acme", memberCount: 1 };

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Build",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
  startedBy: DEAN,
};

const JOURNAL_ID = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const COMMAND = {
  type: "tool-bash",
  toolCallId: "call-build",
  state: "output-available",
  input: { command: "pnpm build" },
};

const WHOLE_OUTPUT = "compiled the first file\ncompiled the middle file\ncompiled the last file";
const WHOLE_THOUGHT = "Start with the build. Then the middle of the thought. Then ship.";

/** A turn whose thought and command output its page carried cut. */
const CUT_TURN: CodingAgentMessage = {
  id: JOURNAL_ID,
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    { type: "step-start" },
    { type: "reasoning", state: "done" },
    COMMAND,
    { type: "text", text: "Built." },
  ],
  cutParts: [
    {
      index: 1,
      field: PART_CUT_FIELD.TEXT,
      bytes: 9_000,
      head: "Start with the build.",
      tail: "Then ship.",
    },
    {
      index: 2,
      field: PART_CUT_FIELD.OUTPUT,
      bytes: 2_000_000,
      head: "compiled the first file",
      tail: "compiled the last file",
    },
  ],
  metadata: { author: "brain" },
  startedAt: 2_000,
  finishedAt: 9_000,
};

let root: Root | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return Effect.runPromise(markdownHtmlParserLanded);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  fakeAppBridge({});
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Lets the window's promises settle. */
async function settled(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The tab drawn over the cut turn, each part read whole answering as `answer` resolves, and the reads it was asked. */
async function drawnTab(answer: (index: number) => Promise<CodingAgentPartView>) {
  const asked: CodingAgentPartParams[] = [];
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([{ ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER }]),
    [ACT_KIND.CODING_AGENTS_PART]: (payload: CodingAgentPartParams) => {
      asked.push(payload);
      return answer(payload.index);
    },
  });
  const control = codingAgentsControl({
    agents: [AGENT],
    me: DEAN.userId,
    transcripts: pushedTranscripts(() => [
      { messages: [CUT_TURN], cursor: "1:0", status: AGENT.status, title: null },
    ]),
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
          children: createElement(AgentTab, {
            agent: AGENT,
            control,
            shown: true,
            onOpenSubagent: () => undefined,
            onHeld: () => undefined,
          }),
        }),
      ),
    ),
  );
  await settled();
  // A finished turn folds its work under one line, which a reader opens first.
  press(container.querySelector<HTMLElement>("[data-turn-fold] > summary"));
  await settled();
  return { container, asked };
}

/** Presses a closed fold's line open, as a reader would. */
function press(summary: HTMLElement | null): void {
  assert.ok(summary, "the fold's line is drawn");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  act(() => summary.click());
}

test("a cut command output is read whole only as its fold opens, says it is reading meanwhile, and is then drawn whole", async () => {
  let land: (part: CodingAgentPartView) => void = () => undefined;
  const { container, asked } = await drawnTab(
    () =>
      new Promise((resolve) => {
        land = resolve;
      }),
  );
  assert.deepEqual(asked, []);

  press(container.querySelector<HTMLElement>('[data-call-id="call-build"] summary'));
  await settled();
  assert.deepEqual(asked, [{ agentId: AGENT.id, messageId: JOURNAL_ID, index: 2 }]);
  const row = container.querySelector('[data-call-id="call-build"]');
  assert.match(row?.textContent ?? "", /Reading the whole output/u);

  land({ part: { ...COMMAND, output: WHOLE_OUTPUT } });
  await settled();
  const output = row?.querySelector("[data-tool-output]")?.textContent ?? "";
  assert.match(output, /compiled the middle file/u);
  assert.doesNotMatch(row?.textContent ?? "", /Reading the whole output/u);
  assert.equal(row?.querySelector("summary")?.getAttribute("aria-expanded"), "true");
});

test("a cut thought is read whole as its fold opens, and one whose read fails draws its two ends", async () => {
  const { container, asked } = await drawnTab((index) =>
    index === 1
      ? Promise.resolve({ part: { type: "reasoning", text: WHOLE_THOUGHT, state: "done" } })
      : Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }),
  );

  press(container.querySelector<HTMLElement>(".reasoning > summary"));
  await settled();
  assert.match(container.querySelector(".reasoning")?.textContent ?? "", /middle of the thought/u);

  press(container.querySelector<HTMLElement>('[data-call-id="call-build"] summary'));
  await settled();
  assert.equal(asked.length, 2);
  const output =
    container.querySelector('[data-call-id="call-build"] [data-tool-output]')?.textContent ?? "";
  assert.match(output, /compiled the first file/u);
  assert.match(output, /compiled the last file/u);
  assert.doesNotMatch(output, /compiled the middle file/u);
});
