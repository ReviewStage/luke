// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_BRIEF,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSender,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import { LINK_PLACE, type LinkPlace, type ReadLink } from "@repo/features/link-grammar";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { ACTOR_KIND } from "@repo/ui/actor-model";
import { MESSAGE_ROLE } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { AutomationDirectory } from "../automation-directory.js";
import { MemberDirectory } from "../member-directory.js";
import { FAKE_ANSWER, type FakeActAnswer, fakeActs, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handHostReads, handMembers, handState, holdAutomations } from "../testing/app-state.js";
import { onRegistry, settleQueries } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { agentsControl, listedAgent, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";
import { OpenLinkProvider } from "./use-open-link.js";

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const MEMBER = AGENT_SENDER.MEMBER;

const CHARLES_PICTURE = "https://lh3.googleusercontent.com/a/charles=s96-c";

const CHARLES_SENT_AT = Date.UTC(2026, 9, 14, 16, 5);

const ACME: Pick<Workspace, "id" | "memberCount"> = { id: "workspace-acme", memberCount: 2 };

const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  {
    ...CHARLES,
    email: "charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
    pictureUrl: CHARLES_PICTURE,
  },
];

const SENDER_ID = "2f9e8d7c-6b5a-4c3d-9e8f-7a6b5c4d3e2f";
const SENDER_TASK = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";

const SENDER_NOW: AgentSummary = {
  id: SENDER_ID,
  planId: SENDER_TASK,
  model: "openai/gpt-6.1-sol",
  effort: "high",
  title: "Split view, merged",
  createdAt: 1_000,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: AGENT_BRIEF.PROMPT,
  startedBy: DEAN,
};

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1_000,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: AGENT_BRIEF.PROMPT,
  startedBy: DEAN,
};

const TRIAGE: AutomationSummary = {
  id: "3f0e6f5c-7d1a-4f6e-9a55-000000000001",
  planId: null,
  planName: null,
  workspaceId: ACME.id,
  name: "Nightly triage",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
  action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage the failures." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

function line(id: string, text: string, sentBy?: AgentSender): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    ...(sentBy === undefined ? undefined : { sentBy }),
  };
}

const MESSAGES: readonly AgentTranscriptMessage[] = [
  line("task", "Add the invite flow."),
  line("dean", "Use seven days.", { ...DEAN, kind: MEMBER }),
  { ...line("charles", "Not five.", { ...CHARLES, kind: MEMBER }), sentAt: CHARLES_SENT_AT },
  line("earlier", "Keep the old copy."),
  line("app", "Rebase on main.", { name: "Vespin", kind: AGENT_SENDER.APP }),
  line("automation", "Triage the failures.", {
    name: "Nightly triage",
    kind: AGENT_SENDER.AUTOMATION,
  }),
  line("gone", "Drop the banner.", { name: "Former member", kind: AGENT_SENDER.FORMER }),
  line("reviewer", "@octocat requested changes on your pull request #12.", {
    name: "octocat",
    kind: AGENT_SENDER.GITHUB,
  }),
  line("review-bot", "@devin-ai-integration[bot] reviewed your pull request #12.", {
    name: "devin-ai-integration[bot]",
    kind: AGENT_SENDER.GITHUB,
  }),
  {
    ...line("app-review", "@review-app[bot] reviewed your pull request #12.", {
      name: "review-app[bot]",
      kind: AGENT_SENDER.GITHUB,
    }),
    metadata: {
      channel: "github",
      event: "review",
      repository: "acme/relay",
      number: 12,
      url: "https://github.com/acme/relay/pull/12#pullrequestreview-1",
      by: "review-app[bot]",
      by_avatar: "https://avatars.githubusercontent.com/in/15368?v=4",
      verdict: "commented",
    },
  },
  line("left", "Keep the banner.", { userId: "user-ana", name: "Ana Ruiz", kind: MEMBER }),
  line("agent", "Thanks, that's everything I need.", { name: "Add PR overview tab", agent: true }),
  line("claude-agent", "The split view is merged.", {
    name: "Split view",
    agent: true,
    model: "anthropic/claude-opus-5.5",
    agentId: SENDER_ID,
  }),
  line("older", "Rebase again.", { name: "Vespin" }),
];

type Seen = readonly [id: string, kind: string, name: string, picture?: string];

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(10_000);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function drawnFor(
  reader: string,
  opened: LinkPlace[] = [],
  agent: AgentSummary = AGENT,
  messages: readonly AgentTranscriptMessage[] = MESSAGES,
  automations?: { readonly rows: readonly AutomationSummary[]; readonly opened: string[] },
): Promise<readonly Element[]> {
  fakeActs({
    act: (): Promise<FakeActAnswer> =>
      Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." }),
  });
  handState({}, { tasks: { ...IDLE_TASKS_VIEW, taskAgents: [listedAgent(SENDER_NOW)] } });
  handMembers(() => ({ rows: { members: MEMBERS } }));
  if (automations !== undefined) {
    holdAutomations(handHostReads({}).deliverAutomations, {
      [AUTOMATION_FOLLOW.WORKSPACE]: () => ({ rows: automations.rows }),
    });
  }
  pushedTranscripts(() => [
    {
      messages: [...messages],
      cursor: "7:0",
      status: AGENT_STATUS.COMPLETED,
      title: null,
    },
  ]);
  const control = agentsControl({
    agents: [agent],
    me: reader,
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
            children: createElement(AutomationDirectory, {
              workspace: { id: ACME.id, name: "Acme" },
              wanted: false,
              onOpen: (automationId: string) => automations?.opened.push(automationId),
              children: createElement(AgentTab, {
                agent,
                control,
                shown: true,
                onOpenSubagent: () => undefined,
                onHeld: () => undefined,
              }),
            }),
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
  const drawn = [...container.querySelectorAll(".is-user, .is-received")];
  assert.equal(drawn.length, messages.length);
  return drawn;
}

const SENDER = ":is(.ui-message-head-sender, .ui-message-line-sender, .github-line-head)";

async function sendersFor(
  reader: string,
  agent: AgentSummary = AGENT,
  messages: readonly AgentTranscriptMessage[] = MESSAGES,
): Promise<readonly Seen[]> {
  const drawn = await drawnFor(reader, [], agent, messages);
  return drawn.flatMap((message, index): Seen[] => {
    const sender = message.querySelector<HTMLElement>(`${SENDER} [data-actor-ref]`);
    if (sender === null) return [];
    const id = messages[index]?.id ?? "";
    const name = sender.querySelector(".ui-inline-ref-label")?.textContent ?? "";
    const picture = sender.querySelector("img")?.getAttribute("src");
    const kind = sender.dataset.kind ?? "";
    return [picture == null ? [id, kind, name] : [id, kind, name, picture]];
  });
}

test("each member sees a teammate's face and name under the teammate's messages and none under their own, Vespin, an automation, and another agent each as itself, someone who left on an outline, and a message with no sender names nobody", async () => {
  const deanSees = await sendersFor(DEAN.userId);
  act(() => root?.unmount());
  const charlesSees = await sendersFor(CHARLES.userId);
  fakeAppBridge({});

  const others: readonly Seen[] = [
    ["app", ACTOR_KIND.APP, "Vespin"],
    ["automation", ACTOR_KIND.AUTOMATION, "Nightly triage"],
    ["gone", ACTOR_KIND.SOMEONE, "Former member"],
    [
      "reviewer",
      ACTOR_KIND.GITHUB,
      "octocat",
      "https://avatars.githubusercontent.com/octocat?v=4&s=32",
    ],
    ["review-bot", ACTOR_KIND.GITHUB, "devin-ai-integration"],
    [
      "app-review",
      ACTOR_KIND.GITHUB,
      "review-app",
      "https://avatars.githubusercontent.com/in/15368?v=4&s=32",
    ],
    ["left", ACTOR_KIND.SOMEONE, "Ana Ruiz"],
    ["agent", ACTOR_KIND.AGENT, "Add PR overview tab"],
    ["claude-agent", ACTOR_KIND.AGENT, "Split view"],
    ["older", ACTOR_KIND.SOMEONE, "Vespin"],
  ];
  assert.deepEqual(deanSees, [
    ["charles", ACTOR_KIND.PERSON, "Charles Pan", CHARLES_PICTURE],
    ...others,
  ]);
  assert.deepEqual(charlesSees, [
    ["task", ACTOR_KIND.PERSON, "Dean Stratakos"],
    ["dean", ACTOR_KIND.PERSON, "Dean Stratakos"],
    ...others,
  ]);
});

test("another agent's message wears the mark of the harness its model runs in, and the mark of no known harness where the service names no model", async () => {
  const drawn = await drawnFor(DEAN.userId);
  const harnessOf = (id: string) => {
    const sender = drawn[MESSAGES.findIndex((message) => message.id === id)]?.querySelector(
      `${SENDER} .actor-mark`,
    );
    const mark = sender?.querySelector(".ui-harness-mark");
    return mark?.getAttribute("data-provider") ?? undefined;
  };

  assert.equal(harnessOf("claude-agent"), MODEL_PROVIDER.ANTHROPIC);
  assert.equal(harnessOf("agent"), undefined);
  fakeAppBridge({});
});

function readingOrder(message: Element, words: string): readonly string[] {
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
  let text: Node | null = walker.nextNode();
  while (text !== null && text.textContent !== words) text = walker.nextNode();
  const seen: [string, Node | null][] = [
    ["words", text],
    ["Copy", message.querySelector('button[aria-label="Copy message"]')],
    ["sender", message.querySelector(SENDER)],
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
  ]?.querySelector<HTMLElement>(`${SENDER} [data-actor-ref]`);
  assert.ok(sender instanceof HTMLButtonElement, "the sender is a door");

  restOn(sender);
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
  const card = document.querySelector(".ui-tooltip-card")?.textContent ?? "";
  act(() => {
    sender.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  act(() => sender.click());

  assert.ok(card.includes("Split view, merged"), card);
  assert.equal(
    sender.querySelector(".ui-harness-mark")?.getAttribute("data-provider"),
    MODEL_PROVIDER.ANTHROPIC,
  );
  assert.deepEqual(opened, [{ kind: LINK_PLACE.AGENT, agentId: SENDER_ID }]);
  fakeAppBridge({});
});

test("a line an automation sent hangs its card and opens its page, on an agent it did not start", async () => {
  const messages = [
    line("task", "Add the invite flow."),
    line("run", "Triage the failures.", {
      name: TRIAGE.name,
      kind: AGENT_SENDER.AUTOMATION,
      automationId: TRIAGE.id,
    }),
  ];
  const opened: string[] = [];
  const drawn = await drawnFor(DEAN.userId, [], AGENT, messages, { rows: [TRIAGE], opened });
  const sender = drawn[1]?.querySelector<HTMLElement>(`${SENDER} [data-actor-ref]`);
  assert.ok(sender instanceof HTMLButtonElement, "the sender is a door");

  restOn(sender);
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.ok(
    document.querySelector(".ui-tooltip-card [data-actor-card='automation']"),
    "the automation's card hangs",
  );
  act(() => {
    sender.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  act(() => sender.click());
  assert.deepEqual(opened, [TRIAGE.id]);
  fakeAppBridge({});
});

test("a teammate's message names them over its bubble, with when and its Copy on the line under it, and the reader's own names nobody", async () => {
  const drawn = await drawnFor(DEAN.userId);
  const byId = (id: string) => drawn[MESSAGES.findIndex((each) => each.id === id)];
  const charles = byId("charles");
  const own = byId("dean");
  assert.ok(charles !== undefined && own !== undefined);
  assert.deepEqual(readingOrder(charles, "Not five."), ["sender", "words", "sent at", "Copy"]);
  assert.equal(
    charles.querySelector("time")?.getAttribute("datetime"),
    new Date(CHARLES_SENT_AT).toISOString(),
  );
  assert.deepEqual(readingOrder(own, "Use seven days."), ["words", "Copy"]);
  fakeAppBridge({});
});

test("an agent started blank draws its first line as a line, no description's card and no task under its starter's name, a line spoken on a call naming no one and a teammate's typed line naming them", async () => {
  const blank: AgentSummary = { ...AGENT, brief: AGENT_BRIEF.BLANK };
  const spoken: AgentTranscriptMessage = {
    ...line("spoken", "What did you change?"),
    metadata: { author: "developer", channel: "voice", voice_session_id: "call-1", from_ms: 0 },
  };
  const typed = line("typed", "Keep the old copy.", { ...DEAN, kind: MEMBER });

  assert.deepEqual(await sendersFor(CHARLES.userId, blank, [spoken, typed]), [
    ["typed", ACTOR_KIND.PERSON, "Dean Stratakos"],
  ]);
  assert.equal(document.querySelector("[data-origin-description]"), null);
});
