// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  type CodingAgentAttachment,
  type CodingAgentFailure,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { composerEditor, installEditorBundle, installEditorLayout } from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { codingAgentsControl } from "#testing/tasks-control";
import { DRAFT_PLACE, type DraftWriter, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts";
import { AgentTab } from "./agent-tab";
import {
  CONTINUE_TRAIL,
  continuationsOf,
  continueTrail,
  endLineContinues,
  endLineReason,
  MESSAGE_RETIRED,
  messageFailureWords,
  startFailureNote,
} from "./coding-agent-model";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import type { AgentContinuer } from "./use-coding-agents";

/**
 * continue-agent.test.ts -- an agent whose turn failed, or whose session
 * ended under a message, is continued in a new agent from its tab: the
 * failed end line ends on Continue in new agent, and a box closed on an
 * ended agent offers it as its note's remedy, carrying the box's words and
 * files and letting them go once the new agent started. Once an agent of the
 * task continues it, both say Continued in with that agent's chip instead.
 * Nothing is offered on a refused API key, an archived task, or a turn
 * that did not fail. Synthetic throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SOURCE = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const NEXT = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
const LATER = "ae3c8c6b-5f4a-4fad-8d88-8b6e9c4a5d43";
const FORK = "bf4d9d7c-6a5b-40be-9e99-9c7fad5b6e54";
const TURN = "c05eae8d-7b6c-41cf-8faa-ad80be6c7f65";

const LABEL = "Continue in new agent";

const NOTES: CodingAgentAttachment = {
  name: "notes.md",
  mediaType: "text/plain",
  data: "IyBOb3Rlcw==",
};

function agentOf(id: string, overrides: Partial<CodingAgentSummary> = {}): CodingAgentSummary {
  return {
    id,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: `Agent ${id.slice(0, 4)}`,
    createdAt: 1_000,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    brief: CODING_AGENT_BRIEF.PLAN,
    ...overrides,
  };
}

const MESSAGES: readonly CodingAgentMessage[] = [
  { id: "plan", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "# Fix the tile" }] },
  {
    id: TURN,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text: "Looking at the tile." }],
    startedAt: 2_000,
    finishedAt: 80_000,
  },
];

const roots: Root[] = [];

installEditorBundle();

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  fakeAppBridge({});
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Lays words and files in the agent's box before its tab draws, as a draft kept from before. */
function Seeded({
  words,
  files,
  onWriter,
}: {
  words: string;
  files: readonly CodingAgentAttachment[];
  onWriter?: (writer: DraftWriter) => void;
}) {
  const writer = useDraftWriter();
  onWriter?.(writer);
  useEffect(() => {
    writer.update({ kind: DRAFT_PLACE.AGENT, planId: TASK, agentId: SOURCE }, () => ({
      ...EMPTY_DRAFT,
      text: words,
      attachments: files,
    }));
  }, [writer, words, files]);
  return null;
}

/**
 * The source agent's tab, standing as `status` with its turn failed for
 * `failure`, over a task whose agents are `others` beside it; every
 * continue and every tab opened written down.
 */
async function drawnTab(input: {
  status: CodingAgentStatus;
  failure?: CodingAgentFailure;
  others?: readonly CodingAgentSummary[];
  archived?: readonly CodingAgentSummary[];
  continues?: boolean;
  onUnarchive?: () => void;
  answer?: () => Promise<Failure | undefined>;
  message?: CodingAgentAgentAnswer;
  seed?: {
    words: string;
    files: readonly CodingAgentAttachment[];
    onWriter?: (writer: DraftWriter) => void;
  };
  messages?: readonly CodingAgentMessage[];
}) {
  fakeAppBridge({
    act: (_request: Act): Promise<ActOutcome> =>
      Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
  const source = agentOf(SOURCE, { status: input.status });
  const continued: {
    agentId: string;
    note: string | undefined;
    attachments: readonly unknown[] | undefined;
  }[] = [];
  const opened: ToolTarget[] = [];
  const continueAgent: AgentContinuer = (agentId, note, attachments) => {
    continued.push({ agentId, note, attachments });
    return input.answer?.() ?? Promise.resolve(undefined);
  };
  let reads = 0;
  const control = codingAgentsControl({
    agents: [source, ...(input.others ?? [])],
    archived: input.archived ?? [],
    continueAgent: input.continues === false ? undefined : continueAgent,
    onUnarchive: input.onUnarchive,
    onMessage: () =>
      Promise.resolve(input.message ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({
        messages: [...(input.messages ?? MESSAGES)],
        cursor: "2:0",
        status: input.status,
        title: null,
        ...(input.failure === undefined ? undefined : { failureReason: input.failure }),
      });
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          input.seed === undefined ? null : createElement(Seeded, input.seed),
          createElement(AgentTab, {
            agent: source,
            control,
            shown: true,
            onOpenSubagent: () => undefined,
            onOpenTarget: (target) => opened.push(target),
            onHeld: () => undefined,
          }),
        ),
      ),
    ),
  );
  await settle();
  const buttons = (within: ParentNode) =>
    [...within.querySelectorAll("button")].filter((each) => each.textContent === LABEL);
  return {
    container,
    continued,
    opened,
    endLine: () =>
      container.querySelector<HTMLElement>(".agent-end-line") ??
      container.querySelector<HTMLElement>("[data-ended]"),
    note: () => container.querySelector<HTMLElement>(".agent-composer-note"),
    buttons,
  };
}

test("the agents that continue an agent are those started from it on its whole transcript, archived ones among them, in the order started, a fork or another agent's continuation left out", () => {
  const first = agentOf(NEXT, { from: { agentId: SOURCE, steps: 4, totalSteps: 4 }, createdAt: 3 });
  const later = agentOf(LATER, {
    from: { agentId: SOURCE, steps: 4, totalSteps: 4 },
    createdAt: 5,
    archivedAt: 9,
  });
  const fork = agentOf(FORK, {
    from: { agentId: SOURCE, messageId: TURN, steps: 2, totalSteps: 4 },
  });
  const elsewhere = agentOf(TURN, { from: { agentId: NEXT, steps: 1, totalSteps: 1 } });

  const found = continuationsOf(SOURCE, [fork, first, elsewhere], [later]);

  assert.deepEqual(
    found.map((each) => each.id),
    [NEXT, LATER],
  );
  assert.deepEqual(continueTrail(found, true), { kind: CONTINUE_TRAIL.CONTINUED, agents: found });
  assert.deepEqual(continueTrail([], true), { kind: CONTINUE_TRAIL.OFFER });
  assert.deepEqual(continueTrail([], false), { kind: CONTINUE_TRAIL.NONE });
});

test("only a failed turn's end line continues the agent, and not one failed on the reader's own refused API key", () => {
  const key = endLineReason(CODING_AGENT_FAILURE.PROVIDER_KEY);
  const other = endLineReason(CODING_AGENT_FAILURE.PROVIDER_KEY, "a teammate");

  assert.equal(endLineContinues(CODING_AGENT_STATUS.FAILED, endLineReason(undefined)), true);
  assert.equal(endLineContinues(CODING_AGENT_STATUS.FAILED, key), false);
  assert.equal(endLineContinues(CODING_AGENT_STATUS.FAILED, other), true);
  assert.equal(endLineContinues(CODING_AGENT_STATUS.CANCELLED, endLineReason(undefined)), false);
  assert.equal(endLineContinues(CODING_AGENT_STATUS.COMPLETED, endLineReason(undefined)), false);
});

test("a message to an ended agent says to continue it in a new one, while a Start refused alike still says to start one", () => {
  assert.equal(messageFailureWords(CODING_AGENT_CALL_FAILURE.AGENT_RETIRED), MESSAGE_RETIRED);
  assert.equal(
    startFailureNote({ failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED }, TASK).text,
    "This agent has ended. Start a new one.",
  );
});

test("a failed turn's end line ends on Continue in new agent, which continues the agent on nothing more, held busy while out, and says beside itself why it did not start", async () => {
  let refuse: (failure: Failure | undefined) => void = () => undefined;
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    answer: () =>
      new Promise((resolve) => {
        refuse = resolve;
      }),
  });
  const line = tab.endLine() ?? assert.fail("the turn ends on its line");
  const [button] = tab.buttons(line);
  assert.ok(button, "the end line offers Continue in new agent");
  assert.equal(line.lastElementChild?.contains(button), true, "at the line's end");

  act(() => button.click());
  assert.deepEqual(tab.continued, [{ agentId: SOURCE, note: undefined, attachments: [] }]);
  assert.equal(button.disabled, true, "held while the press is out");
  assert.equal(button.getAttribute("aria-busy"), "true");

  await act(async () =>
    refuse({ reason: FAILURE_REASON.OTHER, text: "The agent could not be started. Try again." }),
  );
  await settle();
  assert.equal(button.disabled, false);
  assert.match(line.textContent ?? "", /The agent could not be started\. Try again\./);
});

test("no Continue stands on a turn failed on a refused API key, on an archived task, or on a turn that did not fail", async () => {
  const key = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.PROVIDER_KEY,
  });
  assert.equal(key.buttons(key.container).length, 0, "Open API keys is the fix");
  assert.match(key.endLine()?.textContent ?? "", /Open API keys/);

  const archived = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    continues: false,
    onUnarchive: () => undefined,
  });
  assert.ok(archived.endLine(), "the turn still ends on its line");
  assert.equal(archived.buttons(archived.container).length, 0);

  for (const status of [CODING_AGENT_STATUS.CANCELLED, CODING_AGENT_STATUS.COMPLETED]) {
    const settled = await drawnTab({ status });
    assert.equal(settled.buttons(settled.container).length, 0, status);
  }
});

test("once agents of the task continue the agent, its end line names each by its chip in Continue's place, archived ones too, and a chip opens that agent's tab", async () => {
  const from = { agentId: SOURCE, steps: 4, totalSteps: 4 };
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    others: [agentOf(NEXT, { title: "Fix the tile (2)", from, createdAt: 2 })],
    archived: [agentOf(LATER, { title: "Fix the tile (3)", from, createdAt: 3, archivedAt: 4 })],
  });
  const line = tab.endLine() ?? assert.fail("the turn ends on its line");

  assert.equal(tab.buttons(line).length, 0, "the agent is not continued twice");
  const trail = line.querySelector("[data-continued]") ?? assert.fail("Continued in stands");
  assert.match(trail.textContent ?? "", /^Continued in/);
  const chips = [...trail.querySelectorAll<HTMLButtonElement>("button.actor-ref")];
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Fix the tile (2)", "Fix the tile (3)"],
  );
  act(() => chips[0]?.click());
  assert.deepEqual(tab.opened, [{ kind: TOOL_TARGET.AGENT, agent: NEXT }]);
});

test("a box closed on an ended agent offers Continue in new agent beside its note, carrying the box's words and files into the new agent and letting them go once it started", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    message: { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED },
    seed: { words: "Now add the dark variant.", files: [NOTES] },
  });
  const send =
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ??
    assert.fail("the box offers Send");
  await act(async () => send.click());
  await settle();

  const note = tab.note() ?? assert.fail("the box says why it closed");
  assert.match(
    note.textContent ?? "",
    /This agent has ended\. Continue in a new one to carry on\./,
  );
  assert.equal(composerEditor(tab.container).textContent, "Now add the dark variant.");
  const [button] = tab.buttons(note);
  assert.ok(button, "the note's remedy continues the agent");

  await act(async () => button.click());
  await settle();
  assert.deepEqual(tab.continued, [
    { agentId: SOURCE, note: "Now add the dark variant.", attachments: [NOTES] },
  ]);
  assert.equal(composerEditor(tab.container).textContent, "", "the words went on with it");
});

test("a box closed on an ended agent that another already continues names it in the note, offering no second continue", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    message: { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED },
    seed: { words: "Carry on.", files: [] },
    others: [
      agentOf(NEXT, {
        title: "Fix the tile (2)",
        from: { agentId: SOURCE, steps: 1, totalSteps: 1 },
      }),
    ],
  });
  const send =
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ??
    assert.fail("the box offers Send");
  await act(async () => send.click());
  await settle();

  const note = tab.note() ?? assert.fail("the box says why it closed");
  assert.equal(tab.buttons(note).length, 0);
  assert.match(
    note.querySelector("[data-continued]")?.textContent ?? "",
    /Continued in.*Fix the tile \(2\)/,
  );
});

test("a failed agent that never wrote a line still offers Continue on the line that says how it ended", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.NOT_STARTED,
    messages: [],
  });
  const line = tab.endLine() ?? assert.fail("the empty tab says how it ended");

  assert.match(line.textContent ?? "", /^Failed/);
  assert.equal(tab.buttons(line).length, 1);
});

test("a failed agent whose box closed on its ending offers Continue in the box's note alone, so the words it holds are never left behind", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    message: { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED },
    seed: { words: "Finish the tests.", files: [] },
  });
  assert.equal(tab.buttons(tab.endLine() ?? assert.fail("the turn ends on its line")).length, 1);
  const send =
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ??
    assert.fail("the box offers Send");
  await act(async () => send.click());
  await settle();

  assert.equal(tab.buttons(tab.endLine() ?? assert.fail("the line stands")).length, 0);
  assert.equal(tab.buttons(tab.note() ?? assert.fail("the box says why it closed")).length, 1);
});

test("words changed in the closed box while its continue is out stay once it lands, since the new agent was handed the earlier ones", async () => {
  let writer: DraftWriter | undefined;
  let land: (failure: Failure | undefined) => void = () => undefined;
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    message: { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED },
    seed: {
      words: "Fix tests",
      files: [],
      onWriter: (each) => {
        writer = each;
      },
    },
    answer: () =>
      new Promise((resolve) => {
        land = resolve;
      }),
  });
  const send =
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ??
    assert.fail("the box offers Send");
  await act(async () => send.click());
  await settle();
  const [button] = tab.buttons(tab.note() ?? assert.fail("the box says why it closed"));
  assert.ok(button);
  act(() => button.click());

  // Another window writes on in the same draft while the Start is out.
  act(() =>
    writer?.update({ kind: DRAFT_PLACE.AGENT, planId: TASK, agentId: SOURCE }, (was) => ({
      ...was,
      text: "Fix tests and lint",
    })),
  );
  await act(async () => land(undefined));
  await settle();

  assert.deepEqual(
    tab.continued.map((each) => each.note),
    ["Fix tests"],
  );
  assert.equal(composerEditor(tab.container).textContent, "Fix tests and lint");
});

test("a failed agent whose box closed still names the agents that continued it on its end line, which stands whatever replaces the box", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    message: { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED },
    seed: { words: "Finish the tests.", files: [] },
    others: [
      agentOf(NEXT, {
        title: "Fix the tile (2)",
        from: { agentId: SOURCE, steps: 1, totalSteps: 1 },
      }),
    ],
  });
  const send =
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ??
    assert.fail("the box offers Send");
  await act(async () => send.click());
  await settle();

  const line = tab.endLine() ?? assert.fail("the turn ends on its line");
  assert.match(
    line.querySelector("[data-continued]")?.textContent ?? "",
    /Continued in.*Fix the tile \(2\)/,
  );
  assert.equal(tab.buttons(tab.container).length, 0, "nothing offers a second continue");
});
