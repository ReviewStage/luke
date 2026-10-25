// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { layContainersAt } from "../testing/container-width.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { codingAgentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";
import { CallStartMarker } from "./call-card.js";

/**
 * agent-call-fold.test.ts -- on a call into an agent, its tab reads as a
 * conversation: the developer's line, what the voice said, and the turn
 * whose words the voice read aloud folded closed under that, its
 * reasoning, calls, written answer, and how long it worked one press away,
 * a line typed on the call alike. A call into a busy agent, whose ask
 * joined the turn under way, folds only the work after the join under
 * the answer, and a turn the service names by `readFrom` alone, as it does
 * for a reply said long after the turn settled, folds the same way. A turn
 * outside a call is drawn as it always was, and a call is marked at each
 * end by a labelled rule on no band of its own, its start pinned to the
 * log's top while the call stands. Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };

const ACME: Pick<Workspace, "id" | "memberCount"> = { id: "workspace-acme", memberCount: 1 };

/** The store's id for the call's session. */
const CALL = "3f6b2c1e-8a4d-4f0e-9b7c-1d2e3f4a5b6c";

/** Ten minutes past an hour after the epoch, when the call started. */
const CALL_START = 4_200_000;

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
  startedBy: DEAN,
};

const STEP: WireRecord = { type: "step-start" };

/** The prompt the agent was started on, before any call. */
const TASK: CodingAgentMessage = {
  id: "task",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "Look into how invites expire." }],
};

/** What the developer said on the call, which the voice handed the agent as its ask. */
const ASKED: CodingAgentMessage = {
  id: "asked",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "How long does an invite last?" }],
  metadata: {
    author: "developer",
    channel: "voice",
    voice_session_id: CALL,
    from_ms: 1_000,
    to_ms: 3_000,
    delegation_id: "delegation-1",
  },
  sentAt: CALL_START + 1_000,
};

/** A line the voice said on the call, reading the turn of `readFrom` aloud where it names one. */
function voiceLine(id: string, text: string, at: number, readFrom?: string): CodingAgentMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text }],
    metadata: {
      author: "voice_model",
      channel: "voice",
      voice_session_id: CALL,
      from_ms: at,
      to_ms: at + 1_000,
      delegation_id: "delegation-1",
      ...(readFrom === undefined ? undefined : { read_from: readFrom }),
    },
    sentAt: CALL_START + at,
  };
}

/** One of the agent's turns, finished: a thought, a search of the code, and its written answer. */
function turn(id: string, answer: string, startedAt: number): CodingAgentMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      STEP,
      { type: "reasoning", text: "Find where the expiry is set.", state: "done" },
      {
        type: "tool-run_command",
        toolCallId: `${id}-grep`,
        state: "output-available",
        input: { command: "rg INVITE_TTL" },
        output: { exitCode: 0, stdout: "src/invite.ts", stderr: "" },
      },
      STEP,
      { type: "text", text: answer },
    ],
    metadata: { author: "brain" },
    startedAt,
    finishedAt: startedAt + 11_000,
  };
}

const ACK = voiceLine("ack", "Checking now.", 3_500);
const SPOKEN_TURN = turn(
  "spoken-turn",
  "Invites expire after seven days (src/invite.ts).",
  CALL_START + 4_000,
);
const REPLY = voiceLine("reply", "Seven days.", 16_000, "spoken-turn");

/** A line typed into the composer while the call stood (#4307), and the turn and reply it led to. */
const TYPED: CodingAgentMessage = {
  id: "typed",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "And for a resent invite?" }],
  metadata: { author: "developer", channel: "typed", voice_session_id: CALL, from_ms: 20_000 },
  sentAt: CALL_START + 20_000,
};
const TYPED_TURN = turn(
  "typed-turn",
  "A resent invite starts a fresh seven days.",
  CALL_START + 21_000,
);
const TYPED_REPLY = voiceLine("typed-reply", "It starts over.", 33_000, "typed-turn");

/** A line typed after the call ended, and the turn it led to, which no voice said. */
const LATER: CodingAgentMessage = {
  id: "later",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "Make it fourteen days." }],
};
const LATER_TURN = turn(
  "later-turn",
  "Done: invites now last fourteen days.",
  CALL_START + 120_000,
);

/** A turn the agent was on before the call: a search in its first step, then a test run and its written answer in its second. */
const BUSY_TURN: CodingAgentMessage = {
  id: "busy-turn",
  turnId: "turn-busy",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    STEP,
    { type: "reasoning", text: "Find where the expiry is set.", state: "done" },
    {
      type: "tool-run_command",
      toolCallId: "busy-turn-grep",
      state: "output-available",
      input: { command: "rg INVITE_TTL" },
      output: { exitCode: 0, stdout: "src/invite.ts", stderr: "" },
    },
    STEP,
    {
      type: "tool-run_command",
      toolCallId: "busy-turn-test",
      state: "output-available",
      input: { command: "pnpm test" },
      output: { exitCode: 0, stdout: "ok", stderr: "" },
    },
    { type: "text", text: "Invites now last fourteen days, and the tests pass." },
  ],
  metadata: { author: "brain" },
  startedAt: CALL_START - 30_000,
  finishedAt: CALL_START + 40_000,
};

/** What the developer said on a call into the agent while that turn ran, which joined it after its first step. */
const JOINED: CodingAgentMessage = {
  ...ASKED,
  id: "joined",
  parts: [{ type: "text", text: "Where are you with the invites?" }],
  arrivedIn: { journalId: "busy-turn", afterStep: 1 },
  sentAt: CALL_START + 5_000,
};

/** What the voice answered while the turn still ran: the service names the turn and the join, and no `read_from`, which it writes only once a turn settled. */
const JOINED_REPLY: CodingAgentMessage = {
  ...voiceLine("joined-reply", "Found the expiry; the tests are running.", 12_000),
  readFrom: { turnId: "turn-busy", afterStep: 1 },
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
  document.head.innerHTML = "";
  fakeAppBridge({});
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** The tab drawn over one page of `messages`, with the call on record as having ended a minute in. */
async function drawnTab(messages: readonly CodingAgentMessage[]): Promise<HTMLElement> {
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([{ ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER }]),
  });
  const control = codingAgentsControl({
    agents: [AGENT],
    me: DEAN.userId,
    transcripts: pushedTranscripts(() => [
      { messages: [...messages], cursor: "9:0", status: AGENT.status, title: null },
    ]),
    readCalls: () =>
      Promise.resolve({
        transcript: {
          calls: [
            {
              id: CALL,
              startedAt: CALL_START,
              endedAt: CALL_START + 60_000,
              messages: [
                { id: "said-1", role: "user", parts: [{ type: "text", text: "How long?" }] },
              ],
            },
          ],
          earlierOmitted: false,
        },
      }),
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
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/**
 * What the tab draws, top to bottom: the call's divider and closing line,
 * each message by its id, each fold's line and whether it is open, each
 * call by its command, and each "Worked for" line.
 */
function drawnOrder(container: HTMLElement): readonly string[] {
  return [
    ...container.querySelectorAll(
      '[data-call-marker="start"], [data-call-ended], [data-message-id], [data-turn-fold] > summary, [data-call-id], [data-worked]',
    ),
  ].map((element) => {
    if (element.matches('[data-call-marker="start"]')) return "call begins";
    if (element.matches("[data-call-ended]")) return "call ended";
    if (element.matches("[data-message-id]"))
      return `message: ${element.getAttribute("data-message-id")}`;
    if (element.matches("summary")) {
      return `fold: ${element.textContent} (${element.getAttribute("aria-expanded") === "true" ? "open" : "closed"})`;
    }
    if (element.matches("[data-call-id]")) return `call: ${element.getAttribute("data-call-id")}`;
    return "worked for";
  });
}

/** Presses the fold line `summary` names open, as a reader would. */
function pressFold(container: HTMLElement, summary: string): void {
  const line = [...container.querySelectorAll<HTMLElement>("[data-turn-fold] > summary")].find(
    (each) => each.textContent === summary && each.getAttribute("aria-expanded") === "false",
  );
  assert.ok(line, `a closed fold says "${summary}"`);
  act(() => line.click());
}

test("on a call, the turn the voice read aloud folds closed under what was said, and pressing the fold opens its reasoning, call, written answer, and how long it worked", async () => {
  const container = await drawnTab([TASK, ASKED, ACK, SPOKEN_TURN, REPLY]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: asked",
    "message: ack",
    "message: reply",
    "message: spoken-turn",
    "fold: 1 tool call, 1 message (closed)",
    "call ended",
  ]);
  assert.doesNotMatch(container.textContent ?? "", /Invites expire after seven days/u);

  pressFold(container, "1 tool call, 1 message");
  const opened = container.textContent ?? "";
  assert.match(opened, /Invites expire after seven days/u, "the written answer is inside the fold");
  assert.ok(
    container.querySelector('[data-call-id="spoken-turn-grep"]'),
    "the call is inside the fold",
  );
  assert.match(opened, /Thought/u, "the reasoning is inside the fold");
  assert.match(opened, /Worked for 11s/u, "how long it worked is inside the fold");
});

test("a line the developer said while the turn ran stands ahead of what the voice said, since the voice answered it too, and the turn's work folds whole under the answer", async () => {
  const steer: CodingAgentMessage = {
    ...ASKED,
    id: "steer",
    parts: [{ type: "text", text: "Check resent invites too." }],
    arrivedIn: { journalId: "spoken-turn", afterStep: 1 },
    sentAt: CALL_START + 8_000,
  };
  const container = await drawnTab([TASK, ASKED, ACK, steer, SPOKEN_TURN, REPLY]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: asked",
    "message: ack",
    "message: steer",
    "message: reply",
    "message: spoken-turn",
    "fold: 1 tool call, 1 message (closed)",
    "call ended",
  ]);
});

test("a line from elsewhere that reached a spoken turn, as GitHub's, stays where it arrived among the turn's work, splitting its fold", async () => {
  const github: CodingAgentMessage = {
    id: "github",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "@devin-ai-integration[bot] reviewed your pull request #3016." }],
    sentBy: { name: "devin-ai-integration[bot]", kind: CODING_AGENT_SENDER.GITHUB },
    arrivedIn: { journalId: "spoken-turn", afterStep: 1 },
  };
  const container = await drawnTab([TASK, ASKED, ACK, github, SPOKEN_TURN, REPLY]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: asked",
    "message: ack",
    "message: reply",
    "message: spoken-turn",
    "fold: 1 tool call (closed)",
    "message: github",
    "fold: 1 message (closed)",
    "call ended",
  ]);
});

test("a spoken turn keeps its Copy and its Copy link inside its fold, under its written answer", async () => {
  const container = await drawnTab([TASK, ASKED, ACK, SPOKEN_TURN, REPLY]);
  const turn = container.querySelector('[data-message-id="spoken-turn"]');
  assert.equal(turn?.querySelector("[data-turn-foot]"), null, "no foot stands outside the fold");

  pressFold(container, "1 tool call, 1 message");
  const fold = turn?.querySelector("[data-turn-fold]");
  const foot = fold?.querySelector("[data-turn-foot]");
  assert.ok(foot, "the fold ends on the turn's foot");
  assert.match(foot.textContent ?? "", /Worked for 11s/u);
  assert.ok(
    [...foot.querySelectorAll("button")].some(
      (button) => button.getAttribute("aria-label") === "Copy message",
    ),
    "its Copy is in the foot",
  );
});

test("a line typed on the call folds the same way: the line, what the voice said, then the turn behind it, closed", async () => {
  const container = await drawnTab([TASK, TYPED, TYPED_TURN, TYPED_REPLY]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: typed",
    "message: typed-reply",
    "message: typed-turn",
    "fold: 1 tool call, 1 message (closed)",
    "call ended",
  ]);
  assert.doesNotMatch(container.textContent ?? "", /fresh seven days/u);
});

test("on a call into a busy agent, the answer to an ask that joined its turn under way stands after the ask among the turn's work, and once the turn ends only the work after the join folds under it", async () => {
  const container = await drawnTab([TASK, JOINED, JOINED_REPLY, BUSY_TURN]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: busy-turn",
    "fold: 1 tool call (closed)",
    "message: joined",
    "message: joined-reply",
    "fold: 1 tool call, 1 message (closed)",
    "call ended",
  ]);
  assert.doesNotMatch(container.textContent ?? "", /fourteen days/u);

  pressFold(container, "1 tool call, 1 message");
  assert.ok(
    container.querySelector('[data-call-id="busy-turn-test"]'),
    "the work after the join is inside its fold",
  );
  assert.match(container.textContent ?? "", /fourteen days/u, "so is the turn's written answer");
  assert.match(container.textContent ?? "", /Worked for 1m 10s/u, "and how long it worked");
});

test("two asks that joined a busy turn at the same step each stand ahead of their own answer", async () => {
  const second: CodingAgentMessage = {
    ...JOINED,
    id: "joined-again",
    parts: [{ type: "text", text: "And the resend path?" }],
    sentAt: CALL_START + 20_000,
  };
  const secondReply: CodingAgentMessage = {
    ...voiceLine("joined-again-reply", "Same expiry there.", 25_000),
    readFrom: { turnId: "turn-busy", afterStep: 1 },
  };
  const container = await drawnTab([TASK, JOINED, JOINED_REPLY, second, secondReply, BUSY_TURN]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: busy-turn",
    "fold: 1 tool call (closed)",
    "message: joined",
    "message: joined-reply",
    "message: joined-again",
    "message: joined-again-reply",
    "fold: 1 tool call, 1 message (closed)",
    "call ended",
  ]);
});

test("a reply the service names its turn for by readFrom alone, as one said minutes after the turn settled, folds that turn under it as one said at once does", async () => {
  const late = {
    ...voiceLine("late", "Seven days.", 50_000),
    readFrom: { turnId: "turn-spoken" },
  };
  const container = await drawnTab([
    TASK,
    ASKED,
    ACK,
    { ...SPOKEN_TURN, turnId: "turn-spoken" },
    late,
  ]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: asked",
    "message: ack",
    "message: late",
    "message: spoken-turn",
    "fold: 1 tool call, 1 message (closed)",
    "call ended",
  ]);
  assert.doesNotMatch(container.textContent ?? "", /Invites expire after seven days/u);
});

test("a line the voice said that the service names no turn for stands where it was said, and the turn before it is drawn unfolded", async () => {
  const aside = voiceLine("aside", "Nothing to add.", 50_000);
  const container = await drawnTab([TASK, ASKED, ACK, SPOKEN_TURN, aside]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "call begins",
    "message: asked",
    "message: ack",
    "message: spoken-turn",
    "fold: 1 tool call (closed)",
    "worked for",
    "message: aside",
    "call ended",
  ]);
  assert.match(container.textContent ?? "", /Invites expire after seven days/u);
});

test("a turn outside a call is drawn as it always was: its work folded and its written answer and how long it worked under it, and a voice line naming a turn the page does not hold stands where it was said", async () => {
  const stray = voiceLine("stray", "That one ended a while ago.", 50_000, "gone-turn");
  const container = await drawnTab([TASK, LATER, LATER_TURN, stray]);

  assert.deepEqual(drawnOrder(container), [
    "message: task",
    "message: later",
    "message: later-turn",
    "fold: 1 tool call (closed)",
    "worked for",
    "call begins",
    "message: stray",
    "call ended",
  ]);
  assert.match(container.textContent ?? "", /Done: invites now last fourteen days\./u);
});

/** The panel's sheets and the utilities its app compiles, laid into the test's document. */
function layTasksSheet(): void {
  layContainersAt({});
}

test('a call opens at a labelled rule, "Call started" and when, and closes at one, "Call ended", how long it ran, and when, each a pill on a rule with no band of its own', async () => {
  layTasksSheet();
  const container = await drawnTab([TASK, ASKED, ACK, SPOKEN_TURN, REPLY]);
  const start = container.querySelector<HTMLElement>('[data-call-marker="start"]');
  const end = container.querySelector<HTMLElement>('[data-call-marker="end"]');
  assert.ok(start, "the call opens at its marker");
  assert.ok(end, "and closes at one");
  assert.match(start.textContent ?? "", /^Call started · .+\d:\d\d [AP]M$/u);
  assert.ok(start.querySelector(".call-marker-icon svg"), "beside the voice's waveform");
  assert.doesNotMatch(start.textContent ?? "", /Live/u, "an ended call is not live");
  assert.match(end.textContent ?? "", /^Call ended · 1m 0s · .+\d:\d\d [AP]M$/u);
  assert.ok(end.querySelector(".call-marker-icon svg"), "beside a hang-up glyph");
  for (const marker of [start, end]) {
    const style = getComputedStyle(marker);
    assert.match(style.backgroundColor, /^(|transparent|rgba\(0, 0, 0, 0\))$/u, "no band");
    assert.notEqual(style.position, "sticky", "an ended call's markers scroll with its lines");
    assert.equal(marker.querySelectorAll(".call-marker-rule").length, 2, "a rule either side");
    assert.ok(marker.querySelector(".call-marker-pill"), "the words on a pill");
  }
  assert.ok(
    start.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the start stands before the end",
  );
});

test("a standing call's start marker says Live and stays pinned to the top of the log while its lines scroll", () => {
  layTasksSheet();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(CallStartMarker, { startedAt: CALL_START, live: true, now: CALL_START }),
    ),
  );
  const marker = container.querySelector<HTMLElement>('[data-call-marker="start"]');
  assert.ok(marker);
  assert.match(marker.textContent ?? "", /^Call started · .+Live$/u);
  const style = getComputedStyle(marker);
  assert.equal(style.position, "sticky", "pinned while the call's lines scroll under it");
  assert.equal(style.top, "0px");
});
