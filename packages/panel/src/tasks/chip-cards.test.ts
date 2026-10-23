// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { CODING_AGENT_CALL_FAILURE, INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@luke/features/page-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { TaskCard } from "../desktop/task-card.js";
import { MemberDirectory } from "../member-directory.js";
import { type AnyAct, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { ChipCards, type TaskFocus } from "./chip-cards.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * chip-cards.test.ts -- a chip of a place in Luke hangs the card the window
 * hangs for that place wherever it names it: a plan's card for a plan, the
 * same card's head and the section's heading for a section, or the
 * version for a version; a page's title, version, and when it moved; a
 * file's or a folder's path, repository, and where it is read; a member's
 * card; an Inbox item's Inbox row's own card; an automation's card,
 * its workspace's automations read as it is first hung. A place the window
 * holds nothing of keeps the chip's own card. Synthetic workspace, plan,
 * page, people, and automation.
 */

const AT = 1_792_000_000_000;

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

const PAGE_ID = "26494df1-595a-4364-abf7-85781c65a9f8";

const ITEM_ID = "item_4b9e";

/** A coding agent on no task, which shows its pages on itself. */
const SWEEP_AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** Another agent on no task, which the reader cannot reach. */
const HIDDEN_AGENT = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";

/** The page the agent on no task showed on itself, as a read of its pages lists it. */
const SWEEP_PAGE: PageLine = {
  id: "4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d",
  title: "Flake ledger",
  version: 2,
  at: AT,
  shownBy: { kind: PAGE_SHOWER.AGENT, agentId: SWEEP_AGENT },
};

/** A plan the window does not hold open, and a page on it, read as its card is hung. */
const OTHER_TASK = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";

const ROLLOUT_PAGE: PageLine = {
  id: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  title: "Rollout tracker",
  version: 1,
  at: AT,
  shownBy: { kind: PAGE_SHOWER.LUKE },
};

const SAM = "user-sam";

/** The reader, who is not Sam. */
const DEAN = "user-dean";

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 2,
};

const PLACE: MentionPlace = { workspace: "acme", repository: "acme/relay" };

const HOME = "https://tryluke.dev/acme";

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: SAM, name: "Sam Okafor", email: "sam@example.com", role: WORKSPACE_ROLE.OWNER },
];

/** Another workspace of the account's, where Sam is a member rather than the owner, and which runs an automation of its own. */
const BETA: Workspace = { ...ACME, id: "workspace-beta", name: "Beta", slug: "beta" };

const BETA_MEMBERS: readonly WorkspaceMember[] = [
  { userId: SAM, name: "Sam Okafor", email: "sam@example.com", role: WORKSPACE_ROLE.MEMBER },
];

const TASK: TaskSummary = {
  id: TASK_ID,
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

const PLAN_TEXT = "## Goal\n\nInvite by email.\n\n## Roll it out\n\nStore first.\n";

const SWEEP: AutomationSummary = {
  id: "3f0e6f5c-7d1a-4f6e-9a55-000000000001",
  planId: null,
  planName: null,
  workspaceId: ACME.id,
  name: "Nightly sweep",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Sweep flaky tests." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: AT,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

const AUDIT: AutomationSummary = {
  ...SWEEP,
  id: "3f0e6f5c-7d1a-4f6e-9a55-000000000002",
  workspaceId: BETA.id,
  name: "Weekly audit",
};

/** Main's document holding the plan, its page, and an Inbox item waiting on it. */
const STATE: AppStateSnapshot = (() => {
  const snapshot = stateWith({}, {});
  return {
    ...snapshot,
    tasks: {
      ...IDLE_TASKS_VIEW,
      tasks: [TASK],
      tasklessAgents: [
        {
          id: SWEEP_AGENT,
          planId: null,
          turnId: null,
          title: "Sweep the flaky tests",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          status: CODING_AGENT_STATUS.COMPLETED,
          createdAt: AT,
          automationId: null,
          workspaceId: ACME.id,
          repository: "acme/relay",
          activityAt: AT,
        },
      ],
      workspaces: [ACME, BETA],
      activeTaskId: TASK_ID,
      pages: [
        {
          id: PAGE_ID,
          title: "Unfurl matrix",
          version: 3,
          at: AT,
          shownBy: { kind: PAGE_SHOWER.LUKE },
        },
      ],
    },
    inbox: {
      ...snapshot.inbox,
      waiting: [
        {
          taskId: TASK_ID,
          items: [{ id: ITEM_ID, agentId: "agent-1", title: "Keep expired links?", postedAt: AT }],
        },
      ],
    },
  };
})();

/** The plan's agent's message asking a choice, open until the reader answers it. */
const ASKING = {
  id: "e7a1c3d5-2b4f-4e6a-8c9d-0f1e2d3c4b5a",
  author: INBOX_MESSAGE_AUTHOR.AGENT,
  text: "Expired invite links pile up.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Keep them a week" }, { label: "Drop them at once" }],
    recommended: "Keep them a week",
    status: INBOX_ASK_STATUS.OPEN,
  },
  createdAt: AT,
} as const;

/** An item of the plan's agent, open and asking a choice, as the service answers one. */
const WAITING: InboxItem = {
  id: ITEM_ID,
  agentId: "agent-1",
  key: "4b9e",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Keep expired links?",
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  thread: [ASKING],
  postedAt: AT,
  updatedAt: AT,
};

/** An item of the same plan the reader answered, which main's document no longer lists as waiting. */
const ANSWERED_ITEM = "item_7d2c";

const ANSWERED: InboxItem = {
  ...WAITING,
  id: ANSWERED_ITEM,
  key: "7d2c",
  title: "Rename the invite email?",
  status: INBOX_STATUS.ANSWERED,
  settledAt: AT,
  answeredBy: { userId: DEAN, name: "Dean Stratakos" },
  thread: [
    { ...ASKING, ask: { ...ASKING.ask, status: INBOX_ASK_STATUS.ANSWERED } },
    {
      id: "f8b2d4e6-3c5a-4f7b-9d0e-1a2b3c4d5e6f",
      author: INBOX_MESSAGE_AUTHOR.MEMBER,
      member: { userId: DEAN, name: "Dean Stratakos" },
      text: "",
      answers: { ask: ASKING.id, reply: INBOX_REPLY.CHOSE, choices: ["Keep them a week"] },
      createdAt: AT,
    },
  ],
};

/** An item of the agent on no task, answered too. */
const SWEEP_ITEM = "item_9a1f";

const SWEPT: InboxItem = {
  ...ANSWERED,
  id: SWEEP_ITEM,
  agentId: SWEEP_AGENT,
  key: "9a1f",
  title: "Quarantine the flaky test?",
};

/** Whether the host refuses the inbox streams, as it does while the service cannot be reached. */
let inboxRefused = false;

/** The host's side of the inbox streams: the plan's items and the agent on no task's, each followed as a chip's glyph or card reads them. */
const inboxes = followedInboxes((scope) => {
  if (inboxRefused) return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
  if (scope.kind === INBOX_SCOPE_KIND.PLAN && scope.id === TASK_ID) {
    return { items: [WAITING, ANSWERED] };
  }
  if (scope.kind === INBOX_SCOPE_KIND.AGENT && scope.id === SWEEP_AGENT) return { items: [SWEPT] };
  return undefined;
});

/** Every act the panel told the main process, in order. */
const told: AnyAct[] = [];

/** Every workspace whose automations the act port was asked for, in order. */
const automationReads: (string | undefined)[] = [];

/** Every agent on no task whose pages the act port was asked for, in order. */
const agentPageReads: string[] = [];

let root: Root | undefined;

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  told.length = 0;
  automationReads.length = 0;
  agentPageReads.length = 0;
  inboxRefused = false;
});

/** The plan's card as the window's plans make it, with what a chip hangs it for. */
const taskCards = {
  taskCard: (taskId: string, now: number, focus: TaskFocus | undefined) =>
    taskId !== TASK_ID
      ? undefined
      : createElement(TaskCard, {
          task: TASK,
          models: [],
          pictures: false,
          now,
          onOpenGitHub: () => undefined,
          onShowAgent: () => undefined,
          focus,
        }),
};

/** The plan's page, whose words the section's heading is read from. */
const PAGE: TaskMentionsValue = {
  taskId: TASK_ID,
  taskName: TASK.name,
  workspace: PLACE.workspace,
  repository: PLACE.repository,
  text: () => PLAN_TEXT,
  doors: {
    taskId: TASK_ID,
    place: PLACE,
    anchors: new Set(["goal", "roll-it-out"]),
    onOpenTask: () => undefined,
    onOpenFile: undefined,
  },
};

/** The words drawn as a transcript draws them on the plan's page, in a window holding `STATE`. */
async function drawn(text: string): Promise<HTMLElement> {
  fakeAppBridge({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(STATE),
  });
  fakeActPort({
    ...inboxes.procedures,
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: ({ workspaceId }) =>
      Promise.resolve(workspaceId === BETA.id ? BETA_MEMBERS : MEMBERS),
    [ACT_KIND.AUTOMATIONS_LIST]: (payload) => {
      automationReads.push(payload.workspaceId);
      const beta = payload.workspaceId === BETA.id;
      return Promise.resolve({ automations: beta ? [AUDIT] : [SWEEP] });
    },
    // The agent on no task's pages are its own; an agent the reader cannot reach lists none, as the service answers it.
    [ACT_KIND.TASKS_PAGES]: (place) => {
      if (!("agentId" in place)) {
        return Promise.resolve({ pages: place.taskId === OTHER_TASK ? [ROLLOUT_PAGE] : [] });
      }
      agentPageReads.push(place.agentId);
      return Promise.resolve(
        place.agentId === SWEEP_AGENT ? { pages: [SWEEP_PAGE] } : { pages: [] },
      );
    },
  });
  fakeAppPlatform({ pageFrameUrl });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const words: ReactNode = createElement(TaskMentions, {
    value: PAGE,
    children: createElement(TranscriptWords, { text }),
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MemberDirectory, {
          workspace: ACME,
          readerId: DEAN,
          children: createElement(ChipCards, { value: taskCards, children: words }),
        }),
      ),
    ),
  );
  await settle();
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
  });
}

/** The card the chip hangs once what it reads has landed, its words by part. */
async function cardOf(chip: Element | undefined) {
  assert.ok(chip, "the place is drawn as its chip");
  restOn(chip);
  await settle();
  const card = [...document.querySelectorAll(".luke-tooltip-card > *")].at(-1);
  assert.ok(card, "the chip hangs a card");
  const look = {
    card: [...card.attributes].map((attribute) => attribute.name).find((name) => name !== "class"),
    name: card.querySelector(".luke-hover-card-name")?.textContent,
    sub: card.querySelector(".luke-hover-card-sub")?.textContent,
    corner: card.querySelector(".luke-hover-card-corner")?.textContent,
    notes: [...card.querySelectorAll(".luke-hover-card-note")].map((note) => note.textContent),
    focus: card.querySelector("[data-task-card-focus]")?.textContent,
    details: [...card.querySelectorAll('.luke-hover-card-row[data-look="detail"]')].map(
      (detail) => detail.textContent,
    ),
  };
  assert.equal(carriesWords(card, look.name ?? ""), false, "the card's words ride no attribute");
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return look;
}

/** The attributes the session recording masks (`../session-replay.ts`), which may carry words. */
const MASKED = new Set(["title", "aria-label", "aria-description", "alt", "href", "src"]);

/** Whether any element of the card carries `words` on an attribute the recording keeps. */
function carriesWords(card: Element, words: string): boolean {
  return [card, ...card.querySelectorAll("*")]
    .flatMap((element) => [...element.attributes])
    .some(
      (attribute) => !MASKED.has(attribute.name) && words !== "" && attribute.value.includes(words),
    );
}

/** Each chip drawn in the words, in order. */
function chipsOf(container: HTMLElement): readonly Element[] {
  return [...container.querySelectorAll("[data-mention-ref]")];
}

test("a plan's chip hangs the plan's card, and a section's the same card's head with the heading the anchor names", async () => {
  const container = await drawn(
    [
      mentionMarkdown({ kind: MENTION_KIND.TASK, taskId: TASK_ID }, "the plan", PLACE),
      mentionMarkdown(
        { kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "roll-it-out" },
        "rollout",
        PLACE,
      ),
      mentionMarkdown(
        { kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "pricing" },
        "Pricing",
        PLACE,
      ),
      `[v4](${HOME}/plan/${TASK_ID}/version/4)`,
    ].join(" "),
  );
  const [task, section, gone, version] = chipsOf(container);

  const taskCard = await cardOf(task);
  const sectionCard = await cardOf(section);

  assert.equal(taskCard.card, "data-task-card");
  assert.equal(taskCard.name, TASK.name);
  assert.deepEqual(taskCard.details, ["acme/relay"]);
  assert.equal(taskCard.focus, undefined);
  assert.equal(sectionCard.card, "data-task-card");
  assert.equal(sectionCard.name, TASK.name);
  assert.equal(sectionCard.focus, "Roll it out");
  assert.equal((await cardOf(gone)).focus, "Pricing · No longer in the plan");
  assert.equal((await cardOf(version)).focus, "Version 4");
});

test("a page's chip hangs its title, its version and who showed it, and when it moved, a page of a plan not open read as it is first hung; one neither the window nor the read holds keeps the chip's own card", async () => {
  const container = await drawn(
    [
      mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: TASK_ID, pageId: PAGE_ID }, "", PLACE),
      mentionMarkdown(
        {
          kind: MENTION_KIND.PAGE,
          taskId: TASK_ID,
          pageId: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
        },
        "Old draft",
        PLACE,
      ),
      mentionMarkdown(
        { kind: MENTION_KIND.PAGE, taskId: OTHER_TASK, pageId: PAGE_ID },
        "Another plan's page",
        PLACE,
      ),
      mentionMarkdown(
        { kind: MENTION_KIND.PAGE, taskId: OTHER_TASK, pageId: ROLLOUT_PAGE.id },
        "",
        PLACE,
      ),
    ].join(" "),
  );
  const [held, unheld, elsewhere, closed] = chipsOf(container);

  const page = await cardOf(held);
  const other = await cardOf(unheld);
  const another = await cardOf(elsewhere);
  const read = await cardOf(closed);

  assert.equal(page.card, "data-page-card");
  assert.equal(page.name, "Unfurl matrix");
  assert.equal(page.sub, "Version 3 · Shown by Luke");
  assert.ok(page.corner, "the corner says when the page last moved");
  assert.equal(other.card, "data-mention-card");
  assert.equal(other.name, "Old draft");
  // A page id the open plan holds, named on another plan, is not the open plan's page.
  assert.equal(another.card, "data-mention-card");
  assert.equal(another.name, "Another plan's page");
  // A page of a plan not open hangs its tab's card all the same, as an Inbox item's bar names it.
  assert.equal(read.card, "data-page-card");
  assert.equal(read.name, "Rollout tracker");
  assert.equal(read.sub, "Shown by Luke");
});

test("a chip of a page an agent on no task showed hangs the same card as a plan's page, read as it is first hung: its title, its version and the agent that showed it, and when it moved, over its preview; one the agent's pages hold not, or of an agent the reader cannot reach, keeps the chip's own card", async () => {
  const container = await drawn(
    [
      mentionMarkdown(
        { kind: MENTION_KIND.PAGE, agentId: SWEEP_AGENT, pageId: SWEEP_PAGE.id },
        "",
        PLACE,
      ),
      mentionMarkdown(
        { kind: MENTION_KIND.PAGE, agentId: SWEEP_AGENT, pageId: PAGE_ID },
        "Old ledger",
        PLACE,
      ),
      mentionMarkdown(
        { kind: MENTION_KIND.PAGE, agentId: HIDDEN_AGENT, pageId: SWEEP_PAGE.id },
        "Someone's ledger",
        PLACE,
      ),
    ].join(" "),
  );
  assert.deepEqual(agentPageReads, [], "words full of chips read nothing until one is looked at");
  const [shown, unheld, hidden] = chipsOf(container);

  const page = await cardOf(shown);
  assert.equal(page.card, "data-page-card");
  assert.equal(page.name, "Flake ledger");
  assert.equal(page.sub, "Version 2 · Shown by Sweep the flaky tests");
  assert.ok(page.corner, "the corner says when the page last moved");
  assert.equal(
    document.querySelector(".luke-tooltip-card .luke-page-thumb-frame")?.getAttribute("src"),
    pageFrameUrl({ agentId: SWEEP_AGENT, pageId: SWEEP_PAGE.id, version: 2 }),
    "the preview is the agent's page at its newest version",
  );

  const other = await cardOf(unheld);
  assert.equal(other.card, "data-mention-card");
  assert.equal(other.name, "Old ledger");
  const refused = await cardOf(hidden);
  assert.equal(refused.card, "data-mention-card");
  assert.equal(refused.name, "Someone's ledger");
});

test("a file's and a folder's chips hang their path, their repository, and where they are read", async () => {
  const container = await drawn(
    [
      mentionMarkdown({ kind: MENTION_KIND.FILE, path: "apps/web/store.ts" }, "store", PLACE),
      mentionMarkdown(
        {
          kind: MENTION_KIND.FILE,
          path: "apps/web/store.ts",
          lines: { commit: "0a1b2c3d4e5f", startLine: 3, endLine: 5 },
        },
        "the lines",
        PLACE,
      ),
      mentionMarkdown({ kind: MENTION_KIND.FOLDER, path: "apps/web" }, "web", PLACE),
    ].join(" "),
  );
  const [file, lines, folder] = chipsOf(container);

  assert.deepEqual(
    [await cardOf(file), await cardOf(lines), await cardOf(folder)].map((card) => [
      card.name,
      card.sub,
      card.notes,
    ]),
    [
      ["apps/web/store.ts", "acme/relay", ["On the default branch"]],
      ["apps/web/store.ts", "acme/relay", ["Lines 3–5 at 0a1b2c3"]],
      ["apps/web/", "acme/relay", ["On the default branch"]],
    ],
  );
});

test("an Inbox item's chip wears its agent's tile and hangs its Inbox row's own card, whether the item waits or was answered, on a task or on an agent with no task", async () => {
  const container = await drawn(
    [
      `[waiting](${HOME}/plan/${TASK_ID}/inbox/${ITEM_ID})`,
      `[answered](${HOME}/plan/${TASK_ID}/inbox/${ANSWERED_ITEM})`,
      `[swept](${HOME}/agent/${SWEEP_AGENT}/inbox/${SWEEP_ITEM})`,
    ].join(" "),
  );
  const [waiting, answered, swept] = chipsOf(container);

  for (const chip of [waiting, answered, swept]) {
    assert.ok(
      chip?.querySelector('.actor-mark[data-kind="agent"]'),
      "the chip leads with the agent's tile",
    );
  }
  const asking = await cardOf(waiting);
  const settled = await cardOf(answered);
  const sweep = await cardOf(swept);

  assert.equal(asking.card, "data-inbox-row-card");
  assert.equal(asking.name, "Keep expired links?");
  assert.equal(asking.sub, "Needs you");
  assert.equal(settled.card, "data-inbox-row-card");
  assert.equal(settled.name, "Rename the invite email?");
  assert.match(settled.sub ?? "", /^Answered/u);
  assert.equal(sweep.card, "data-inbox-row-card");
  assert.equal(sweep.name, "Quarantine the flaky test?");
});

test("an Inbox item's labelled chip is called by the item's title, whether it waits or was answered", async () => {
  const container = await drawn(
    [
      `[@Inbox item](${HOME}/plan/${TASK_ID}/inbox/${ITEM_ID})`,
      `[@Inbox item](${HOME}/plan/${TASK_ID}/inbox/${ANSWERED_ITEM})`,
      `[@Inbox item](${HOME}/agent/${SWEEP_AGENT}/inbox/${SWEEP_ITEM})`,
    ].join(" "),
  );

  assert.deepEqual(
    chipsOf(container).map((chip) => chip.querySelector(".luke-inline-ref-label")?.textContent),
    ["Keep expired links?", "Rename the invite email?", "Quarantine the flaky test?"],
  );
});

test("an Inbox item's chip whose inbox could not be read keeps the card main's brief makes of a waiting item, and the chip's own for an item it does not hold", async () => {
  inboxRefused = true;
  const container = await drawn(
    [
      `[waiting](${HOME}/plan/${TASK_ID}/inbox/${ITEM_ID})`,
      `[answered](${HOME}/plan/${TASK_ID}/inbox/${ANSWERED_ITEM})`,
    ].join(" "),
  );
  const [waiting, answered] = chipsOf(container);

  const brief = await cardOf(waiting);
  const own = await cardOf(answered);

  assert.equal(brief.card, "data-inbox-item-card");
  assert.equal(brief.name, "Keep expired links?");
  assert.deepEqual(brief.notes, ["Waiting for an answer"]);
  assert.equal(own.card, "data-mention-card");
});

test("a member's chip hangs their card", async () => {
  const container = await drawn(`Ask [Sam](${HOME}/person/${SAM}).`);

  const member = await cardOf(chipsOf(container)[0]);

  assert.equal(member.card, "data-actor-card");
  assert.equal(member.name, "Sam Okafor");
  assert.equal(member.sub, "sam@example.com");
});

test("an automation's chip hangs its card, the workspace's automations read only once the card is hung", async () => {
  const container = await drawn(`Run by [the sweep](${HOME}/automation/${SWEEP.id}).`);
  const reads = () => automationReads.length;
  const before = reads();

  const card = await cardOf(chipsOf(container)[0]);

  assert.equal(before, 0, "nothing is read as the chip is drawn");
  assert.equal(card.card, "data-actor-card");
  assert.equal(card.name, "Nightly sweep");
  assert.equal(reads(), 1);
});

test("a member's and an automation's chips under another workspace's link are read as that workspace holds them, not the words' own", async () => {
  const container = await drawn(
    `Ask [Sam](https://tryluke.dev/beta/person/${SAM}) about [the audit](https://tryluke.dev/beta/automation/${AUDIT.id}).`,
  );
  const [person, automation] = chipsOf(container);

  const member = await cardOf(person);
  const audit = await cardOf(automation);

  assert.deepEqual([member.name, member.corner], ["Sam Okafor", "Member"]);
  assert.equal(audit.name, "Weekly audit");
});

test("a member's chip under a link naming its workspace by id, as one with no slug is written, is read as that workspace holds them", async () => {
  const container = await drawn(`Ask [Sam](https://tryluke.dev/${BETA.id}/person/${SAM}).`);

  const member = await cardOf(chipsOf(container)[0]);

  assert.deepEqual([member.name, member.corner], ["Sam Okafor", "Member"]);
});
