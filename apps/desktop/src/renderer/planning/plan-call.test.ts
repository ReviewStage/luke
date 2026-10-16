// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_TOOL, EVE_TOOL } from "@luke/features/agent-tools";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { PlanEditor } from "@luke/features/task-wire";
import { TASK_WORK_STATE } from "@luke/features/tasks-view";
import { TRANSCRIPT_PART_TYPE } from "@luke/features/transcript-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { TRANSCRIPT_SPEAKER, type TranscriptSpeaker } from "@luke/live";
import { ACTOR_KIND } from "@luke/ui/actor-model";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "@luke/voice/transcript-model";
import { TURN_ORIGIN } from "@luke/wire";
import type { UIMessage } from "ai";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, test } from "vitest";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { conversationOf, toolCall, words, worker, workerCall, workTurn } from "#testing/plan-work";
import { codingAgentsControl } from "#testing/plans-control";
import { planCards } from "../desktop/side-panel";
import { MemberDirectory } from "../member-directory";
import { NOTHING_HELD } from "./agent-ref";
import { CodeCardHeader } from "./code-pane";
import { PlanCall } from "./plan-call";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import { workRowsOf } from "./work-model";

/** The Call tab as a test draws it: what it is given over a plan with no planning turn, which reads no older page and opens nothing. */
function callTab(
  props: Partial<Parameters<typeof PlanCall>[0]> & Pick<Parameters<typeof PlanCall>[0], "region">,
) {
  return createElement(PlanCall, {
    onRetry: () => undefined,
    conversation: undefined,
    callLive: false,
    onLoadEarlier: () => Promise.resolve(),
    onOpenSubagent: () => undefined,
    shown: true,
    ...props,
  });
}

/** Synthetic words throughout. */
function said(count: number): TranscriptRegion {
  return {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 1_000,
        live: true,
        lukeEnded: false,
        messages: Array.from({ length: count }, (_, index) => ({
          id: String(index),
          role: TRANSCRIPT_SPEAKER.USER,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: `Line ${index}` }],
        })),
      },
    ],
  };
}

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The tab drawn into the page, for a test to read as a reader would. */
function mounted(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a stop names the subagent it stopped by that subagent's job, a start in an earlier turn included, and a stop of a task no turn here started names the task, though a call sent it more work", () => {
  const styling = worker("w", "Read the styling setup.\n\nStart with the theme.", {
    taskId: "worker-1",
  });
  const steering = worker("r", "Also read the build.", { taskId: "worker-0" });
  const started = workTurn(
    TASK_WORK_STATE.DONE,
    [
      workerCall(styling),
      toolCall(
        EVE_TOOL.WORKER,
        "r",
        { message: steering.task, taskId: "worker-0" },
        { output: "Sent." },
      ),
      words("A worker is reading it."),
    ],
    { workers: [styling, steering] },
  );
  const stop = (id: string, taskId: string) =>
    toolCall(EVE_TOOL.TASK_CANCEL, id, { taskId }, { output: `Stopped ${taskId}.` });
  const stopping = workTurn(
    TASK_WORK_STATE.RUNNING,
    [stop("c1", "worker-1"), stop("c2", "worker-0")],
    {
      turnId: "turn-2",
      startedAt: 5_000,
    },
  );

  const container = mounted(
    callTab({ region: said(0), conversation: conversationOf([started, stopping]), callLive: true }),
  );
  const row = (id: string) => container.querySelector(`[data-call-id="${id}"]`)?.textContent;
  assert.match(row("c1") ?? "", /Stopped subagent\s*Read the styling setup\./u);
  assert.match(row("c2") ?? "", /Stopped subagent\s*worker-0/u);
});

test("a finished spoken turn is one folded line under the line that asked for it, its words and how long it worked inside the fold and nothing of them outside, and the call's end line after it", () => {
  const region: TranscriptRegion = {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 1_000,
        live: false,
        lukeEnded: true,
        record: { endedAt: 90_000 },
        messages: [
          {
            id: "ask",
            role: TRANSCRIPT_SPEAKER.USER,
            metadata: { rowIds: ["row-ask"] },
            parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Let's end the call now." }],
          },
          {
            id: "bye",
            role: TRANSCRIPT_SPEAKER.ASSISTANT,
            parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Alright, take care." }],
          },
        ],
      },
    ],
  };
  const ended = workTurn(
    TASK_WORK_STATE.DONE,
    [
      toolCall(AGENT_TOOL.END_CALL, "c1", {}, { output: { status: "accepted" } }),
      words("Ending the call as asked."),
    ],
    { startedAt: 60_000, endedAt: 67_000, asked: ["row-ask"] },
  );

  const container = mounted(
    callTab({ region, conversation: conversationOf([ended]), callLive: false }),
  );
  const fold = container.querySelector("[data-turn-fold]");
  assert.ok(fold);
  assert.equal(fold.textContent, "1 tool call");
  // Outside the fold stand only the lines said: the ask before the work, the goodbye and the call's end after it.
  const outside = (container.textContent ?? "").replace(fold.textContent ?? "", "");
  assert.doesNotMatch(outside, /Ending the call as asked|Worked for|Failed|Stopped/u);
  assert.match(outside, /Let's end the call now\.[\s\S]*Alright, take care\./u);
  // Opened, the fold holds the call, the words, and how long the turn worked.
  const summary = fold.querySelector("summary");
  assert.ok(summary);
  act(() => summary.click());
  assert.match(fold.textContent ?? "", /Ended the call[\s\S]*Ending the call as asked\./u);
  assert.ok(fold.querySelector("[data-worked]"), "how long the turn worked stands inside its fold");
  const order = [...container.querySelectorAll("[data-turn-fold], p")].map(
    (each) => each.textContent ?? "",
  );
  const at = (start: string) => order.findIndex((text) => text.startsWith(start));
  assert.ok(
    at("Let's end the call") < at("1 tool call") && at("1 tool call") < at("Alright, take care"),
    `the fold stands under its ask and before Luke's goodbye: ${order.join(" | ")}`,
  );
});

test("the look around a call opens with, a spoken turn no line asked for, stands at the top of the call standing by time, one folded line with its words and how long it worked inside the fold and nothing of them outside", () => {
  const region: TranscriptRegion = {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 100_000,
        live: true,
        lukeEnded: false,
        messages: [
          {
            id: "r1",
            role: TRANSCRIPT_SPEAKER.USER,
            metadata: { span: { startMs: 5_000, endMs: 6_000 } },
            parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Hello there." }],
          },
          {
            id: "r2",
            role: TRANSCRIPT_SPEAKER.ASSISTANT,
            metadata: { span: { startMs: 7_000, endMs: 8_000 } },
            parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Hi, what are we planning?" }],
          },
        ],
      },
    ],
  };
  const explore = workTurn(
    TASK_WORK_STATE.DONE,
    [
      toolCall(AGENT_TOOL.RUN_IN_REPOSITORY, "c1", { command: "ls" }, { output: "README.md" }),
      words("This is Luke, a macOS voice-planning app."),
    ],
    { startedAt: 95_000, endedAt: 103_000, origin: TURN_ORIGIN.SPOKEN },
  );

  const container = mounted(
    callTab({ region, conversation: conversationOf([explore]), callLive: true }),
  );
  const fold = container.querySelector("[data-turn-fold]");
  assert.ok(fold);
  assert.equal(fold.textContent, "1 tool call");
  const outside = (container.textContent ?? "").replace(fold.textContent ?? "", "");
  assert.doesNotMatch(outside, /This is Luke|Worked for/u);
  const order = [...container.querySelectorAll("[data-turn-fold], p")].map(
    (each) => each.textContent ?? "",
  );
  const at = (start: string) => order.findIndex((text) => text.startsWith(start));
  assert.ok(
    at("1 tool call") < at("Hello there") && at("Hello there") < at("Hi, what are we"),
    `the look around stands at the call's top, before every line: ${order.join(" | ")}`,
  );
  const summary = fold.querySelector("summary");
  assert.ok(summary);
  act(() => summary.click());
  assert.match(fold.textContent ?? "", /This is Luke, a macOS voice-planning app\./u);
  assert.ok(fold.querySelector("[data-worked]"), "how long the turn worked stands inside its fold");
});

test("on the Call tab, a subagent's row hangs its tab's card, its title and how it ended, and a coding agent's start hangs the agent's tab's card", () => {
  const styling = worker("w", "Read the styling setup.", {
    taskId: "worker-1",
    title: "Styling setup",
    state: TASK_WORK_STATE.FAILED,
  });
  const turn = workTurn(
    TASK_WORK_STATE.DONE,
    [
      workerCall(styling),
      toolCall(
        AGENT_TOOL.START_AGENT,
        "s",
        { task: "Ship the invoice export" },
        { output: { status: "accepted", agent: { id: "agent-9" } } },
      ),
      words("Both are under way."),
    ],
    { workers: [styling] },
  );
  const conversation = conversationOf([turn]);
  const agents = codingAgentsControl({
    agents: [
      {
        id: "agent-9",
        planId: "plan-1",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Invoice export",
        createdAt: 1,
        status: CODING_AGENT_STATUS.RUNNING,
        turnId: null,
      },
    ],
  });
  const cards = planCards({
    agents,
    workRows: workRowsOf(conversation, false),
    held: NOTHING_HELD,
    chosen: () => false,
    shownCode: [],
  });
  const page = mounted(
    callTab({
      region: said(0),
      conversation,
      cards: cards.call,
      onOpenTarget: () => undefined,
    }),
  );
  // A finished turn folds under one line, and its calls under another, each opened by a press.
  for (const fold of page.querySelectorAll<HTMLElement>("details > summary")) {
    act(() => fold.click());
  }
  const cardOn = (row: HTMLElement | null) => {
    assert.ok(row, "the row is drawn");
    document.documentElement.dataset.keyboard = "true";
    act(() => row.focus());
    const card = document.querySelector(".tooltip-card [data-tab-card]");
    assert.ok(card, "the row hangs a tab's card");
    return [
      card.querySelector(".card-name")?.textContent,
      card.querySelector(".card-corner")?.textContent,
    ];
  };
  assert.deepEqual(cardOn(page.querySelector("button[data-subagent-row]")), [
    "Styling setup",
    "Failed",
  ]);
  assert.deepEqual(cardOn(page.querySelector('button[data-call-id="s"]')), [
    "Invoice export",
    "Working…",
  ]);
});

test("on the Call tab, a show_code row says its lines as the Code tab's card says them, hangs the file's card with Luke's note, and opens the file on those lines", () => {
  const ref = { path: "src/invites/accept.ts", startLine: 3, endLine: 5 };
  const turn = workTurn(TASK_WORK_STATE.DONE, [
    toolCall(AGENT_TOOL.SHOW_CODE, "c", ref, { output: { status: "shown" } }),
  ]);
  const conversation = conversationOf([turn]);
  const note = "A used invite is refused here.";
  const cards = planCards({
    agents: codingAgentsControl(),
    workRows: workRowsOf(conversation, false),
    held: NOTHING_HELD,
    chosen: () => false,
    shownCode: [
      {
        callId: "c",
        turnId: "t",
        shownAt: 1_000,
        code: { ref, repository: "acme/relay", firstLine: 1, lineCount: 9, lines: [], note },
      },
    ],
  });
  const opened: ToolTarget[] = [];
  const page = mounted(
    callTab({
      region: said(0),
      conversation,
      cards: cards.call,
      onOpenTarget: (target) => opened.push(target),
    }),
  );
  for (const fold of page.querySelectorAll<HTMLElement>("details > summary")) {
    act(() => fold.click());
  }
  const head = document.createElement("div");
  head.innerHTML = renderToStaticMarkup(
    createElement(CodeCardHeader, { codeRef: ref, note, copied: undefined, onOpen: undefined }),
  );
  const lines = head.querySelector(".file-ref-lines")?.textContent;
  assert.equal(lines, "Lines 3–5");
  const row = page.querySelector<HTMLElement>('button[data-call-id="c"]');
  assert.ok(row, "the row opens the file");
  assert.equal(row.textContent, `Showed ${ref.path}, ${lines}`);
  document.documentElement.dataset.keyboard = "true";
  act(() => row.focus());
  const card = document.querySelector(".tooltip-card [data-file-card]");
  assert.deepEqual(
    [
      card?.querySelector(".card-name")?.textContent,
      card?.querySelector(".card-note")?.textContent,
    ],
    [ref.path, note],
  );
  act(() => row.click());
  assert.deepEqual(opened, [{ kind: TOOL_TARGET.SHOWN_CODE, call: "c", ref }]);
});

/** Charles's sign-in picture, which the members read lists. */
const CHARLES_PICTURE = "https://lh3.googleusercontent.com/a/charles=s96-c";

/** The plan's workspace's members as the members read answers them: the reader, Dean, and Charles with his picture. */
const MEMBERS: readonly WorkspaceMember[] = [
  {
    userId: "user-dean",
    name: "Dean Stratakos",
    email: "dean@example.com",
    role: WORKSPACE_ROLE.OWNER,
  },
  {
    userId: "user-charles",
    name: "Charles Pan",
    email: "charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
    pictureUrl: CHARLES_PICTURE,
  },
];

/** A spoken line of the call's, by who said it. */
function spoken(id: string, role: TranscriptSpeaker, text: string): UIMessage {
  return { id, role, parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }] };
}

/** An actor named over something as a reader sees it: what kind of mark it wears, the name beside it, and the picture on it. */
function seen(ref: Element | null): readonly (string | undefined)[] | undefined {
  if (!(ref instanceof HTMLElement)) return undefined;
  const picture = ref.querySelector("img")?.getAttribute("src") ?? undefined;
  const named = [ref.dataset.kind, ref.querySelector(".actor-ref-name")?.textContent ?? undefined];
  return picture === undefined ? named : [...named, picture];
}

test("a teammate's call is headed with their face and name, their lines carry it and Luke's carry his, and the reader's own call names nobody", async () => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
        ),
    },
  });
  const drawn = async (caller: PlanEditor | undefined) => {
    const page = mounted(
      createElement(MemberDirectory, {
        workspace: { id: "workspace-acme", memberCount: 2 },
        readerId: "user-dean",
        children: callTab({
          region: {
            kind: TRANSCRIPT_REGION.READY,
            earlierOmitted: false,
            calls: [
              {
                key: "call-1",
                startedAt: 1_000,
                live: false,
                lukeEnded: false,
                messages: [
                  spoken("1", TRANSCRIPT_SPEAKER.USER, "Seven days."),
                  spoken("2", TRANSCRIPT_SPEAKER.ASSISTANT, "Seven it is."),
                  spoken("3", TRANSCRIPT_SPEAKER.USER, "Thanks."),
                ],
                caller,
              },
            ],
          },
        }),
      }),
    );
    await act(async () => {
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });
    const divider = page.querySelector("[data-checkpoint]");
    return {
      heading: seen(divider?.querySelector(".actor-ref") ?? null),
      line: divider?.textContent ?? "",
      senders: [...page.querySelectorAll(".message-sender")].map((each) =>
        seen(each.querySelector(".actor-ref")),
      ),
    };
  };

  const teammates = await drawn({ userId: "user-charles", name: "Charles Pan" });
  assert.deepEqual(teammates.heading, [ACTOR_KIND.PERSON, "Charles Pan’s", CHARLES_PICTURE]);
  assert.match(teammates.line, /Charles Pan’s call · /u);
  const charles = [ACTOR_KIND.PERSON, "Charles Pan", CHARLES_PICTURE];
  assert.deepEqual(teammates.senders, [charles, [ACTOR_KIND.LUKE, "Luke"], charles]);

  // A teammate the workspace no longer lists has left it, and keeps their name on an outline.
  const left = await drawn({ userId: "user-ana", name: "Ana Ruiz" });
  assert.deepEqual(left.heading, [ACTOR_KIND.SOMEONE, "Ana Ruiz’s"]);
  assert.deepEqual(left.senders[0], [ACTOR_KIND.SOMEONE, "Ana Ruiz"]);

  const own = await drawn(undefined);
  assert.equal(own.heading, undefined);
  assert.doesNotMatch(own.line, /call/u);
  assert.deepEqual(own.senders, []);
  Reflect.deleteProperty(window, "luke");
});
