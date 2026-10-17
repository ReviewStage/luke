// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSender,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type LinkPlace, type ReadLink } from "@luke/features/luke-link";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { ACTOR_KIND } from "@luke/ui/actor-model";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/tasks-control";
import { MemberDirectory } from "../member-directory";
import { AgentTab } from "./agent-tab";
import { OpenLinkProvider } from "./use-open-link";

/**
 * agent-senders.test.ts -- in an agent's tab, a message a teammate sent the
 * agent carries their face and name under its bubble, as a teammate's line
 * on the Call tab does, and the reader's own carries none; Luke's carries
 * his tile, an automation's its own, GitHub's the login it names, another
 * coding agent's its harness's mark by its name, where the service says
 * the model it runs on, and a member's who has left the quiet
 * outline, and a message from before senders were kept names nobody.
 * Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const MEMBER = CODING_AGENT_SENDER.MEMBER;

/** Charles's sign-in picture, which the members read lists. */
const CHARLES_PICTURE = "https://lh3.googleusercontent.com/a/charles=s96-c";

/** When Charles sent his line. */
const CHARLES_SENT_AT = Date.UTC(2026, 9, 14, 16, 5);

const ACME: Pick<Workspace, "id" | "memberCount"> = { id: "workspace-acme", memberCount: 2 };

/** The workspace's members as the members read answers them: Dean, and Charles with his picture. */
const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  {
    ...CHARLES,
    email: "charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
    pictureUrl: CHARLES_PICTURE,
  },
];

/** The agent that sent the Claude line, on a task of its own. */
const SENDER_ID = "2f9e8d7c-6b5a-4c3d-9e8f-7a6b5c4d3e2f";
const SENDER_TASK = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";

/** That agent as its task's agents are read now: renamed since it sent the line, and moved to another model. */
const SENDER_NOW: CodingAgentSummary = {
  id: SENDER_ID,
  planId: SENDER_TASK,
  model: "openai/gpt-6.1-sol",
  effort: "high",
  title: "Split view, merged",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
  startedBy: DEAN,
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
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
  line("dean", "Use seven days.", { ...DEAN, kind: MEMBER }),
  { ...line("charles", "Not five.", { ...CHARLES, kind: MEMBER }), sentAt: CHARLES_SENT_AT },
  line("earlier", "Keep the old copy."),
  line("luke", "Rebase on main.", { name: "Luke", kind: CODING_AGENT_SENDER.LUKE }),
  line("automation", "Triage the failures.", {
    name: "Nightly triage",
    kind: CODING_AGENT_SENDER.AUTOMATION,
  }),
  line("gone", "Drop the banner.", { name: "Former member", kind: CODING_AGENT_SENDER.FORMER }),
  line("reviewer", "@octocat requested changes on your pull request #12.", {
    name: "octocat",
    kind: CODING_AGENT_SENDER.GITHUB,
  }),
  line("review-bot", "@devin-ai-integration[bot] reviewed your pull request #12.", {
    name: "devin-ai-integration[bot]",
    kind: CODING_AGENT_SENDER.GITHUB,
  }),
  line("left", "Keep the banner.", { userId: "user-ana", name: "Ana Ruiz", kind: MEMBER }),
  line("agent", "Thanks, that's everything I need.", { name: "Add PR overview tab", agent: true }),
  // A service that keeps the sending agent answers the model it ran on, which its harness is read off, and the agent on its task.
  line("claude-agent", "The split view is merged.", {
    name: "Split view",
    agent: true,
    model: "anthropic/claude-opus-5.5",
    agentId: SENDER_ID,
    taskId: SENDER_TASK,
  }),
  // A service older than the sender's kind names Luke by name alone.
  line("older", "Rebase again.", { name: "Luke" }),
];

/** A message's sender as a reader sees it: what kind of mark it wears, the name beside it, and the picture on it. */
type Seen = readonly [id: string, kind: string, name: string, picture?: string];

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The developer's messages as `reader` sees the tab drawn, one element for each of `MESSAGES`, every place a press opened kept in `opened`. */
async function drawnFor(reader: string, opened: LinkPlace[] = []): Promise<readonly Element[]> {
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
          ? { status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS }
          : request.kind === ACT_KIND.CODING_AGENTS_LIST
            ? { status: ACT_OUTCOME_STATUS.DONE, value: { agents: [SENDER_NOW] } }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
      ),
  });
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
        createElement(OpenLinkProvider, {
          value: (link: ReadLink) => opened.push(link.place),
          children: createElement(MemberDirectory, {
            workspace: ACME,
            readerId: reader,
            children: createElement(AgentTab, {
              agent: AGENT,
              control,
              shown: true,
              onOpenSubagent: () => undefined,
              onHeld: () => undefined,
            }),
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const drawn = [...container.querySelectorAll(".is-user")];
  assert.equal(drawn.length, MESSAGES.length);
  return drawn;
}

/** Each of the developer's messages as `reader` sees the tab, by its id, where a sender is drawn with it. */
async function sendersFor(reader: string): Promise<readonly Seen[]> {
  const drawn = await drawnFor(reader);
  return drawn.flatMap((message, index): Seen[] => {
    const sender = message.querySelector<HTMLElement>(".message-sender .actor-ref");
    if (sender === null) return [];
    const id = MESSAGES[index]?.id ?? "";
    const name = sender.querySelector(".actor-ref-name")?.textContent ?? "";
    const picture = sender.querySelector("img")?.getAttribute("src");
    const kind = sender.dataset.kind ?? "";
    return [picture == null ? [id, kind, name] : [id, kind, name, picture]];
  });
}

test("each member sees a teammate's face and name under the teammate's messages and none under their own, Luke, an automation, and another agent each as itself, someone who left on an outline, and a message with no sender names nobody", async () => {
  const deanSees = await sendersFor(DEAN.userId);
  act(() => root?.unmount());
  const charlesSees = await sendersFor(CHARLES.userId);
  fakeAppBridge({});

  // Neither the task nor the line from before senders were kept is named for Dean, nor Dean's own line.
  const others: readonly Seen[] = [
    ["luke", ACTOR_KIND.LUKE, "Luke"],
    ["automation", ACTOR_KIND.AUTOMATION, "Nightly triage"],
    ["gone", ACTOR_KIND.SOMEONE, "Former member"],
    // GitHub names who caused what it told the agent of: a person by their login and its avatar, a bot by its App's.
    [
      "reviewer",
      ACTOR_KIND.GITHUB,
      "octocat",
      "https://avatars.githubusercontent.com/octocat?v=4&s=32",
    ],
    ["review-bot", ACTOR_KIND.GITHUB, "devin-ai-integration"],
    // A member the workspace no longer lists has left it, and keeps their name.
    ["left", ACTOR_KIND.SOMEONE, "Ana Ruiz"],
    // Another coding agent of the workspace is drawn as an agent, not a person, under its name.
    ["agent", ACTOR_KIND.AGENT, "Add PR overview tab"],
    ["claude-agent", ACTOR_KIND.AGENT, "Split view"],
    ["older", ACTOR_KIND.SOMEONE, "Luke"],
  ];
  assert.deepEqual(deanSees, [
    ["charles", ACTOR_KIND.PERSON, "Charles Pan", CHARLES_PICTURE],
    ...others,
  ]);
  assert.deepEqual(charlesSees, [
    // The task is Dean's, whose agent it is, as "Started by" says.
    ["task", ACTOR_KIND.PERSON, "Dean Stratakos"],
    ["dean", ACTOR_KIND.PERSON, "Dean Stratakos"],
    ...others,
  ]);
});

test("another agent's message wears the mark of the harness its model runs in, and the mark of no known harness where the service names no model", async () => {
  const drawn = await drawnFor(DEAN.userId);
  const harnessOf = (id: string) => {
    const sender = drawn[MESSAGES.findIndex((message) => message.id === id)]?.querySelector(
      ".message-sender .actor-mark",
    );
    const mark = sender?.querySelector(".harness-mark");
    return mark === null || mark === undefined ? undefined : mark.tagName.toLowerCase();
  };

  // Claude Code's mark is its Clawd, drawn as an SVG.
  assert.equal(harnessOf("claude-agent"), "svg");
  assert.equal(harnessOf("agent"), undefined);
  fakeAppBridge({});
});

/** What a sent message draws, in the order a reader meets it: its words, its Copy, who sent it, and when. */
function readingOrder(message: Element, words: string): readonly string[] {
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
  let text: Node | null = walker.nextNode();
  while (text !== null && text.textContent !== words) text = walker.nextNode();
  const seen: [string, Node | null][] = [
    ["words", text],
    ["Copy", message.querySelector('button[aria-label="Copy"]')],
    ["sender", message.querySelector(".message-sender")],
    ["sent at", message.querySelector("time")],
  ];
  return seen
    .flatMap(([name, node]) => (node === null ? [] : [{ name, node }]))
    .sort((a, b) =>
      a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .map((each) => each.name);
}

test("another agent named as a line's sender opens its tab on a press and hangs its card as it stands now, while its mark stays the one it sent under", async () => {
  const opened: LinkPlace[] = [];
  const drawn = await drawnFor(DEAN.userId, opened);
  const sender = drawn[
    MESSAGES.findIndex((message) => message.id === "claude-agent")
  ]?.querySelector<HTMLElement>(".message-sender .actor-ref");
  assert.ok(sender instanceof HTMLButtonElement, "the sender is a door");

  await act(async () => {
    sender.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const card = document.querySelector(".luke-tooltip-card")?.textContent ?? "";
  act(() => {
    sender.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  act(() => sender.click());

  assert.ok(card.includes("Split view, merged"), card);
  // The line still wears Claude Code's mark it was sent under, though the agent runs on Codex now.
  assert.equal(sender.querySelector(".harness-mark")?.tagName.toLowerCase(), "svg");
  assert.deepEqual(opened, [{ kind: LINK_PLACE.AGENT, planId: SENDER_TASK, agentId: SENDER_ID }]);
  fakeAppBridge({});
});

test("a sent message keeps its bubble on top, with its Copy, who sent it, and when on the line under it", async () => {
  const drawn = await drawnFor(DEAN.userId);
  const byId = (id: string) => drawn[MESSAGES.findIndex((each) => each.id === id)];
  const charles = byId("charles");
  const own = byId("dean");
  assert.ok(charles !== undefined && own !== undefined);
  assert.deepEqual(readingOrder(charles, "Not five."), ["words", "Copy", "sender", "sent at"]);
  assert.equal(
    charles.querySelector("time")?.getAttribute("datetime"),
    new Date(CHARLES_SENT_AT).toISOString(),
  );
  // The reader's own message names nobody, and still offers its Copy under the bubble; one from a service older than the time names none.
  assert.deepEqual(readingOrder(own, "Use seven days."), ["words", "Copy"]);
  fakeAppBridge({});
});
