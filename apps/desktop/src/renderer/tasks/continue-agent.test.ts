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
  type CodingAgentMessagesAnswer,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { ACTION_RESULT_STATUS, MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { composerEditor, editorBundleLanded, installEditorLayout } from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { codingAgentsControl } from "#testing/tasks-control";
import { DRAFT_PLACE, type DraftWriter, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts";
import { AgentTab } from "./agent-tab";
import {
  continuationsOf,
  continuedByIds,
  END_PRESS,
  endLineContinues,
  endLineParts,
  endLinePress,
  endLineReason,
  MESSAGE_RETIRED,
  messageFailureWords,
  startFailureNote,
} from "./coding-agent-model";
import { ForkProvider } from "./fork-action";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import type { AgentContinuer } from "./use-coding-agents";

/**
 * continue-agent.test.ts -- an agent whose turn failed, or whose session
 * ended under a message, is continued in a new agent from its tab: the
 * failed end line ends on Continue in new agent, on its own row, and a box
 * closed on an ended agent offers it as its note's remedy, carrying the
 * box's words and files and letting them go once the new agent started.
 * Once an agent continues it, whatever it stands as, its box gives way to
 * Continued in with the continuing agents' chips, Continue again, and
 * Archive, the failed end line keeping its press, and Continued in is drawn
 * nowhere else, unless an archive took the box, when the transcript ends
 * on it. Nothing is offered on a refused API key, an archived task, or a
 * turn that did not fail. Synthetic throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SOURCE = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const NEXT = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
const LATER = "ae3c8c6b-5f4a-4fad-8d88-8b6e9c4a5d43";
const FORK = "bf4d9d7c-6a5b-40be-9e99-9c7fad5b6e54";
const TURN = "c05eae8d-7b6c-41cf-8faa-ad80be6c7f65";

const LABEL = "Continue in new agent";
const AGAIN = "Continue again";

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

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

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
  source?: Partial<CodingAgentSummary>;
  onArchive?: (agentId: string, archived: boolean) => void;
  onStop?: (agentId: string) => void;
  answer?: () => Promise<Failure | undefined>;
  message?: CodingAgentAgentAnswer;
  seed?: {
    words: string;
    files: readonly CodingAgentAttachment[];
    onWriter?: (writer: DraftWriter) => void;
  };
  messages?: readonly CodingAgentMessage[];
  /** Whether the tab's place opens the continue as a draft, as the task's column does. */
  drafts?: boolean;
  /** What the first page says the agent and its newest turn cost, the latter as a service older than this window sent it. */
  usage?: Pick<CodingAgentMessagesAnswer, "usage" | "turnUsage">;
}) {
  fakeAppBridge({
    act: (_request: Act): Promise<ActOutcome> =>
      Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
  const source = agentOf(SOURCE, { status: input.status, ...input.source });
  const continued: {
    agentId: string;
    note: string | undefined;
    attachments: readonly unknown[] | undefined;
  }[] = [];
  const opened: ToolTarget[] = [];
  const drafted: { words: string; attachments: readonly CodingAgentAttachment[] }[] = [];
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
    onArchive: (agentId, archived) => {
      input.onArchive?.(agentId, archived);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    onStop: (agentId) => {
      input.onStop?.(agentId);
      return Promise.resolve();
    },
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
        ...input.usage,
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
          createElement(
            ForkProvider,
            {
              value: {
                onFork: undefined,
                forkedTo: () => [],
                onContinue:
                  input.drafts === true
                    ? (words, attachments) => drafted.push({ words, attachments })
                    : undefined,
              },
            },
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
    ),
  );
  await settle();
  const buttons = (within: ParentNode) =>
    [...within.querySelectorAll("button")].filter((each) => each.textContent === LABEL);
  return {
    container,
    continued,
    drafted,
    opened,
    /** The developer's lines in the transcript reading `words`. */
    lines: (words: string) =>
      [...container.querySelectorAll<HTMLElement>(".is-user")].filter((each) =>
        each.textContent?.includes(words),
      ),
    endLine: () =>
      container.querySelector<HTMLElement>(".agent-end") ??
      container.querySelector<HTMLElement>("[data-ended]")?.parentElement ??
      null,
    note: () => container.querySelector<HTMLElement>(".agent-composer-note"),
    continuedNote: () => container.querySelector<HTMLElement>(".continued-composer"),
    continuedIn: () => [...container.querySelectorAll<HTMLElement>("[data-continued]")],
    sendButton: () => container.querySelector<HTMLButtonElement>('button[aria-label="Send"]'),
    named: (within: ParentNode, words: string) =>
      [...within.querySelectorAll("button")].find((each) => each.textContent === words),
    buttons,
    /** The end line's words and the presses on their row, each by what it says. */
    endRow: () => {
      const words = container.querySelector<HTMLElement>("[data-ended] .agent-end-words");
      const row = words?.closest<HTMLElement>(".agent-end-row") ?? null;
      return row === null ? null : { row, presses: buttons(row) };
    },
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
});

test("an agent's continuations are those its summary names, forks left out, then any the task's list names that it does not yet; with no summary's word, the list's alone", () => {
  const from = { agentId: SOURCE, steps: 4, totalSteps: 4 };
  const named = {
    ...agentOf(SOURCE),
    continuedBy: [
      { agentId: LATER, title: null, forked: false },
      { agentId: FORK, title: "A fork", forked: true, messageId: TURN },
    ],
  };
  const listed = [agentOf(NEXT, { from, createdAt: 3 }), agentOf(LATER, { from, createdAt: 2 })];

  assert.deepEqual(continuedByIds(named, listed, []), [LATER, NEXT]);
  assert.deepEqual(continuedByIds(named, undefined, undefined), [LATER]);
  assert.deepEqual(continuedByIds(agentOf(SOURCE), listed, []), [LATER, NEXT]);
  assert.deepEqual(continuedByIds(agentOf(SOURCE), [], []), []);
});

test("the end line's words and whether it tells of a failure come apart, and name no price", () => {
  const failed = endLineParts(CODING_AGENT_STATUS.FAILED, CODING_AGENT_FAILURE.SANDBOX);
  assert.equal(failed?.failed, true);
  assert.match(failed?.words ?? "", /^Failed: /);
  assert.deepEqual(endLineParts(CODING_AGENT_STATUS.CANCELLED, undefined), {
    words: "Stopped",
    failed: false,
  });
  assert.equal(endLineParts(CODING_AGENT_STATUS.FAILED, undefined)?.words, "Failed");
  for (const status of [
    CODING_AGENT_STATUS.STARTING,
    CODING_AGENT_STATUS.RUNNING,
    CODING_AGENT_STATUS.COMPLETED,
  ]) {
    assert.equal(endLineParts(status, undefined), undefined, status);
  }
});

test("a failed turn's end line names no price, even from a service that sent the turn's, while the model menu's foot still says the whole run's", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    usage: {
      usage: { inputTokens: 1_200_000, outputTokens: 30_000, cachedInputTokens: 0, costUsd: 2.41 },
      turnUsage: { inputTokens: 40_000, outputTokens: 900, cachedInputTokens: 0, costUsd: 0.08 },
    },
  });
  const line = tab.endLine() ?? assert.fail("the turn ends on its line");
  assert.match(line.textContent ?? "", /Failed: /);
  assert.doesNotMatch(line.textContent ?? "", /\$/);
  assert.ok(line.querySelector("[data-failed]"), "the line still tells of a failure");

  const chip =
    tab.container.querySelector<HTMLButtonElement>(".agent-model-chip button") ??
    assert.fail("the box offers its model chip");
  act(() => chip.click());
  await settle();
  const menu = tab.container.querySelector(".agent-model-menu") ?? assert.fail("the menu opens");
  assert.match(menu.textContent ?? "", /This agent: 1\.2M tokens · \$2\.41/);
  assert.doesNotMatch(menu.textContent ?? "", /\$0\.08/);
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

test("a failed end line's row ends on a press that carries nothing, carries the box's words once a continued note took the box, and none where a closed box offers its own", () => {
  const failed = { status: CODING_AGENT_STATUS.FAILED, endReason: endLineReason(undefined) };
  const key = { ...failed, endReason: endLineReason(CODING_AGENT_FAILURE.PROVIDER_KEY) };

  assert.equal(endLinePress({ ...failed, continued: false, boxClosed: false }), END_PRESS.EMPTY);
  assert.equal(endLinePress({ ...failed, continued: true, boxClosed: false }), END_PRESS.CARRYING);
  assert.equal(endLinePress({ ...failed, continued: true, boxClosed: true }), END_PRESS.CARRYING);
  assert.equal(endLinePress({ ...failed, continued: false, boxClosed: true }), END_PRESS.NONE);
  assert.equal(endLinePress({ ...key, continued: true, boxClosed: false }), END_PRESS.NONE);
  for (const status of [CODING_AGENT_STATUS.CANCELLED, CODING_AGENT_STATUS.COMPLETED]) {
    const settled = { status, endReason: endLineReason(undefined), boxClosed: false };
    assert.equal(endLinePress({ ...settled, continued: true }), END_PRESS.NONE, status);
  }
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
  const row = tab.endRow() ?? assert.fail("the end line stands on its row");
  assert.deepEqual(row.presses, [button], "on the line's own row, after its words");
  assert.equal(row.row.lastElementChild?.contains(button), true, "at the row's end");

  act(() => button.click());
  assert.deepEqual(tab.continued, [{ agentId: SOURCE, note: undefined, attachments: [] }]);
  assert.equal(button.getAttribute("aria-busy"), "true");
  act(() => button.click());
  assert.equal(tab.continued.length, 1, "held while the press is out");

  await act(async () =>
    refuse({ reason: FAILURE_REASON.OTHER, text: "The agent could not be started. Try again." }),
  );
  await settle();
  assert.equal(button.getAttribute("aria-busy"), null);
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
  // The refused line stays where it went, marked, and the closed box does not draw its words again.
  assert.equal(composerEditor(tab.container).textContent, "", "the words show once");
  assert.ok(
    tab.container.querySelector(".agent-composer[data-closed]"),
    "the box wears its held look",
  );
  assert.equal(tab.lines("Now add the dark variant.").length, 1);
  const [line] = tab.lines("Now add the dark variant.");
  assert.match(
    line?.querySelector("[data-undelivered]")?.textContent ?? "",
    /^Not delivered$/,
    "the line says it did not go",
  );
  const [button] = tab.buttons(note);
  assert.ok(button, "the note's remedy continues the agent");

  await act(async () => button.click());
  await settle();
  assert.deepEqual(tab.continued, [
    { agentId: SOURCE, note: "Now add the dark variant.", attachments: [NOTES] },
  ]);
  assert.equal(composerEditor(tab.container).textContent, "", "the words went on with it");
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
  assert.equal(tab.endRow()?.presses.length, 1, "on the line's own row");
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
  let kept = "";
  act(() =>
    writer?.update({ kind: DRAFT_PLACE.AGENT, planId: TASK, agentId: SOURCE }, (was) => {
      kept = was.text;
      return was;
    }),
  );
  assert.equal(kept, "Fix tests and lint");
});

const FROM_SOURCE = { agentId: SOURCE, steps: 4, totalSteps: 4 };

test("once agents continue the agent, its box gives way to Continued in with each continuing agent's chip, oldest first and archived ones too, which opens that agent's tab, beside Continue again, and the failed end line keeps its press", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    others: [agentOf(LATER, { title: "Fix the tile (3)", from: FROM_SOURCE, createdAt: 3 })],
    archived: [
      agentOf(NEXT, { title: "Fix the tile (2)", from: FROM_SOURCE, createdAt: 2, archivedAt: 4 }),
    ],
  });
  const note = tab.continuedNote() ?? assert.fail("the box gives way to its note");

  assert.equal(tab.sendButton(), null, "the box takes no message");
  assert.equal(tab.endRow()?.presses.length, 1, "the end line still offers Continue");
  assert.ok(tab.named(note, AGAIN), "the note offers Continue again");
  assert.deepEqual(
    [...note.querySelectorAll("button")].slice(-2).map((each) => each.textContent),
    [AGAIN, "Archive"],
    "Continue again beside Archive, at the note's end",
  );
  assert.match(note.textContent ?? "", /^Continued in/);
  const chips = [...note.querySelectorAll<HTMLButtonElement>("button[data-actor-ref]")];
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Fix the tile (2)", "Fix the tile (3)"],
  );
  act(() => chips[0]?.click());
  assert.deepEqual(tab.opened, [{ kind: TOOL_TARGET.AGENT, agent: NEXT }]);
});

test("a continued agent is continued again from its note whatever it stands as, a completed one among them, and from its failed end line, each press a continue of its own carrying the box's words", async () => {
  for (const each of [
    { status: CODING_AGENT_STATUS.COMPLETED },
    { status: CODING_AGENT_STATUS.CANCELLED },
    { status: CODING_AGENT_STATUS.FAILED, failure: CODING_AGENT_FAILURE.SANDBOX },
  ] as const) {
    const tab = await drawnTab({
      ...each,
      others: [agentOf(NEXT, { from: FROM_SOURCE })],
      seed: { words: "Try the other parser.", files: [NOTES] },
    });
    const note = tab.continuedNote() ?? assert.fail("the box gives way to its note");
    const again = tab.named(note, AGAIN) ?? assert.fail(`${each.status} offers Continue again`);
    await act(async () => again.click());
    await settle();
    assert.deepEqual(
      tab.continued,
      [{ agentId: SOURCE, note: "Try the other parser.", attachments: [NOTES] }],
      each.status,
    );
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = "";
    window.localStorage.clear();
  }

  const failed = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    others: [agentOf(NEXT, { from: FROM_SOURCE })],
    drafts: true,
  });
  const [onLine] = failed.endRow()?.presses ?? [];
  assert.ok(onLine, "the end line keeps its press");
  await act(async () => onLine.click());
  await act(async () =>
    failed.named(failed.continuedNote() ?? assert.fail("the note stands"), AGAIN)?.click(),
  );
  assert.deepEqual(
    failed.drafted,
    [
      { words: "", attachments: [] },
      { words: "", attachments: [] },
    ],
    "each opens a fresh draft, empty where the box held nothing",
  );
  assert.deepEqual(failed.continued, [], "nothing is sent until the draft is");
});

test("where the tab's place opens drafts, Continue again opens the continue's draft with the words the box held, and the box lets them go", async () => {
  let writer: DraftWriter | undefined;
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    others: [agentOf(NEXT, { from: FROM_SOURCE })],
    seed: {
      words: "Try the other parser.",
      files: [],
      onWriter: (each) => {
        writer = each;
      },
    },
    drafts: true,
  });
  const note = tab.continuedNote() ?? assert.fail("the box gives way to its note");
  await act(async () => tab.named(note, AGAIN)?.click());
  await settle();

  assert.deepEqual(tab.drafted, [{ words: "Try the other parser.", attachments: [] }]);
  let kept: string | undefined;
  act(() =>
    writer?.update({ kind: DRAFT_PLACE.AGENT, planId: TASK, agentId: SOURCE }, (was) => {
      kept = was.text;
      return was;
    }),
  );
  assert.equal(kept, "", "the words went on into the draft");
});

test("Continued in is named once whatever the continued agent stands as: starting, running, completed, stopped, failed, or failed on a refused key", async () => {
  const cases: readonly { status: CodingAgentStatus; failure?: CodingAgentFailure }[] = [
    { status: CODING_AGENT_STATUS.STARTING },
    { status: CODING_AGENT_STATUS.RUNNING },
    { status: CODING_AGENT_STATUS.COMPLETED },
    { status: CODING_AGENT_STATUS.CANCELLED },
    { status: CODING_AGENT_STATUS.FAILED, failure: CODING_AGENT_FAILURE.SANDBOX },
    { status: CODING_AGENT_STATUS.FAILED, failure: CODING_AGENT_FAILURE.PROVIDER_KEY },
  ];
  for (const each of cases) {
    const tab = await drawnTab({
      ...each,
      others: [agentOf(NEXT, { title: "Fix the tile (2)", from: FROM_SOURCE })],
    });
    const label = `${each.status} ${each.failure ?? ""}`;
    assert.equal(tab.continuedIn().length, 1, label);
    assert.ok(tab.continuedNote()?.contains(tab.continuedIn()[0] ?? null), label);
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = "";
  }
});

test("an agent with only forks keeps its box, since a fork is no continuation", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    others: [
      agentOf(FORK, { from: { agentId: SOURCE, messageId: TURN, steps: 2, totalSteps: 2 } }),
    ],
  });

  assert.equal(tab.continuedNote(), null);
  assert.equal(tab.continuedIn().length, 0);
  assert.ok(tab.sendButton(), "the box still takes a message");
});

test("the continued box's Archive archives a settled agent at once, asks first where it would stop a running turn, and its Stop stands only while a turn runs", async () => {
  const archived: { agentId: string; archived: boolean }[] = [];
  const settled = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    others: [agentOf(NEXT, { from: FROM_SOURCE })],
    onArchive: (agentId, each) => archived.push({ agentId, archived: each }),
  });
  const quiet = settled.continuedNote() ?? assert.fail("the box gives way to its note");
  assert.equal(settled.named(quiet, "Stop"), undefined, "no turn runs to stop");
  await act(async () => settled.named(quiet, "Archive")?.click());
  await settle();
  assert.deepEqual(archived, [{ agentId: SOURCE, archived: true }]);

  archived.length = 0;
  const stopped: string[] = [];
  const running = await drawnTab({
    status: CODING_AGENT_STATUS.RUNNING,
    others: [agentOf(NEXT, { from: FROM_SOURCE })],
    onArchive: (agentId, each) => archived.push({ agentId, archived: each }),
    onStop: (agentId) => stopped.push(agentId),
  });
  const note = running.continuedNote() ?? assert.fail("the box gives way to its note");
  act(() => running.named(note, "Stop")?.click());
  assert.deepEqual(stopped, [SOURCE]);

  await act(async () => running.named(note, "Archive")?.click());
  assert.deepEqual(archived, [], "a running turn is not stopped unasked");
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Archive asks before it stops the turn");
  await act(async () => running.named(question, "Stop and archive")?.click());
  await settle();
  assert.deepEqual(archived, [{ agentId: SOURCE, archived: true }]);
});

test("a continued agent's end line no longer tells the reader to start a new one", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.NOT_STARTED,
    messages: [],
    others: [agentOf(NEXT, { from: FROM_SOURCE })],
  });
  const line = tab.endLine() ?? assert.fail("the empty tab says how it ended");

  assert.match(line.textContent ?? "", /^Failed: the agent never started/);
  assert.doesNotMatch(line.textContent ?? "", /start a new one/);
  assert.match(
    endLineParts(CODING_AGENT_STATUS.FAILED, CODING_AGENT_FAILURE.NOT_STARTED)?.words ?? "",
    /start a new one$/,
    "one not continued still is",
  );
});

test("where an archive took the box, the transcript's end names the agents that continued it instead, under the end line or alone, read from the summary where the list does not hold them", async () => {
  const failed = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    continues: false,
    onUnarchive: () => undefined,
    others: [agentOf(NEXT, { title: "Fix the tile (2)", from: FROM_SOURCE })],
  });
  const end = failed.endLine() ?? assert.fail("the turn ends on its block");
  assert.equal(failed.continuedNote(), null, "the archived note holds the box");
  assert.equal(failed.continuedIn().length, 1);
  assert.match(
    end.querySelector("[data-continued-trail]")?.textContent ?? "",
    /Continued in.*Fix the tile \(2\)/,
  );

  const completed = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    continues: false,
    onUnarchive: () => undefined,
    source: { continuedBy: [{ agentId: NEXT, title: "Fix the tile (2)", forked: false }] },
  });
  assert.equal(
    completed.continuedIn().length,
    1,
    "a completed agent has no end line, yet is named",
  );
  assert.deepEqual(
    [...(completed.continuedIn()[0]?.querySelectorAll("button[data-actor-ref]") ?? [])].map(
      (chip) => chip.textContent,
    ),
    ["Fix the tile (2)"],
    "by the title the summary gives it, though the list does not hold it",
  );
});

test("where the tab's place opens drafts, Continue on a closed box opens the continue's draft with the box's words and files and sends nothing, the box letting them go; on a failed end line it opens one empty", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.FAILED,
    failure: CODING_AGENT_FAILURE.SANDBOX,
    message: { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED },
    seed: { words: "Now add the dark variant.", files: [NOTES] },
    drafts: true,
  });
  const [onLine] = tab.buttons(tab.endLine() ?? assert.fail("the turn ends on its line"));
  assert.ok(onLine, "the end line offers Continue before the box closes");
  await act(async () => onLine.click());
  assert.deepEqual(tab.drafted, [{ words: "", attachments: [] }], "the end line carries nothing");

  const send =
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ??
    assert.fail("the box offers Send");
  await act(async () => send.click());
  await settle();
  const [button] = tab.buttons(tab.note() ?? assert.fail("the box says why it closed"));
  assert.ok(button, "the note's remedy continues the agent");
  await act(async () => button.click());
  await settle();

  assert.deepEqual(tab.drafted.at(-1), {
    words: "Now add the dark variant.",
    attachments: [NOTES],
  });
  assert.deepEqual(tab.continued, [], "nothing is sent until the draft is");
  assert.equal(tab.lines("Now add the dark variant.").length, 1, "the refused line still stands");
  assert.equal(button.disabled, false, "nothing is out to hold the press for");
});

test("a message refused before the transcript has read anything stands as the developer's line marked Not delivered, never as the agent's plan", async () => {
  const tab = await drawnTab({
    status: CODING_AGENT_STATUS.COMPLETED,
    message: { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED },
    seed: { words: "Continue testing.", files: [NOTES] },
    messages: [],
  });
  const send =
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ??
    assert.fail("the box offers Send");
  await act(async () => send.click());
  await settle();

  const [line] = tab.lines("Continue testing.");
  assert.ok(line, "the refused line is the developer's");
  assert.ok(line.querySelector("[data-undelivered]"), "marked as not delivered");
  assert.match(line.textContent ?? "", /notes\.md/u, "with its file");
});
