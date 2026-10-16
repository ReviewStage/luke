// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { EXPERIMENT } from "@luke/settings";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { stateWith } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { TaskCard } from "../desktop/task-card";
import { MemberDirectory } from "../member-directory";
import { ChipCards, type TaskFocus } from "./chip-cards";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";
import { TranscriptWords } from "./transcript-blocks";

/**
 * chip-cards.test.ts -- a chip of a place in Luke hangs the card the window
 * hangs for that place wherever it names it: a plan's card for a plan, the
 * same card's head and the section's heading for a section, or the
 * version for a version; a page's title, version, and when it moved; a
 * file's or a folder's path, repository, and where it is read; a member's
 * card; an Inbox item's question and that it waits; an automation's card,
 * its workspace's automations read as it is first hung. A place the window
 * holds nothing of keeps the chip's own card. Synthetic workspace, plan,
 * page, people, and automation.
 */

const AT = 1_792_000_000_000;

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

const PAGE_ID = "26494df1-595a-4364-abf7-85781c65a9f8";

const ITEM_ID = "item_4b9e";

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

const PLAN: TaskSummary = {
  id: PLAN_ID,
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

/** Main's document holding the plan, its page, and an Inbox item waiting on it, the Automations experiment on. */
const STATE: AppStateSnapshot = (() => {
  const snapshot = stateWith({ [EXPERIMENT.AUTOMATIONS]: true }, {});
  return {
    ...snapshot,
    tasks: {
      ...IDLE_TASKS_VIEW,
      tasks: [PLAN],
      workspaces: [ACME, BETA],
      activeTaskId: PLAN_ID,
      pages: [{ id: PAGE_ID, title: "Unfurl matrix", version: 3, at: AT }],
    },
    inbox: {
      ...snapshot.inbox,
      waiting: [
        {
          taskId: PLAN_ID,
          items: [{ id: ITEM_ID, agentId: "agent-1", title: "Keep expired links?", postedAt: AT }],
        },
      ],
    },
  };
})();

/** Every act the panel told the main process, in order. */
const told: Act[] = [];

let root: Root | undefined;

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  told.length = 0;
});

function answer(request: Act): ActOutcome {
  if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
    const beta = request.payload.workspaceId === BETA.id;
    return { status: ACT_OUTCOME_STATUS.DONE, value: beta ? BETA_MEMBERS : MEMBERS };
  }
  if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
    const beta = request.payload.workspaceId === BETA.id;
    return { status: ACT_OUTCOME_STATUS.DONE, value: { automations: beta ? [AUDIT] : [SWEEP] } };
  }
  return { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." };
}

/** The plan's card as the window's plans make it, with what a chip hangs it for. */
const planCards = {
  taskCard: (taskId: string, now: number, focus: TaskFocus | undefined) =>
    taskId !== PLAN_ID
      ? undefined
      : createElement(TaskCard, {
          task: PLAN,
          models: [],
          pictures: false,
          now,
          onOpenGitHub: () => undefined,
          onShowAgent: () => undefined,
          focus,
        }),
};

/** The plan's page, whose words the section's heading is read from. */
const PAGE: PlanMentionsValue = {
  taskId: PLAN_ID,
  taskName: PLAN.name,
  workspace: PLACE.workspace,
  repository: PLACE.repository,
  text: () => PLAN_TEXT,
  doors: {
    taskId: PLAN_ID,
    place: PLACE,
    anchors: new Set(["goal", "roll-it-out"]),
    onOpenTask: () => undefined,
    onOpenFile: undefined,
  },
};

/** The words drawn as a transcript draws them on the plan's page, in a window holding `STATE`. */
async function drawn(text: string): Promise<HTMLElement> {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      onAppState: () => () => undefined,
      requestAppState: () => Promise.resolve(STATE),
      act: (request: Act): Promise<ActOutcome> => {
        told.push(request);
        return Promise.resolve(answer(request));
      },
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const words: ReactNode = createElement(PlanMentions, {
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
          children: createElement(ChipCards, { value: planCards, children: words }),
        }),
      ),
    ),
  );
  await settle();
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The card the chip hangs once what it reads has landed, its words by part. */
async function cardOf(chip: Element | undefined) {
  assert.ok(chip, "the place is drawn as its chip");
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  await settle();
  const card = [...document.querySelectorAll(".tooltip-card > *")].at(-1);
  assert.ok(card, "the chip hangs a card");
  const look = {
    card: [...card.attributes].map((attribute) => attribute.name).find((name) => name !== "class"),
    name: card.querySelector(".card-name")?.textContent,
    sub: card.querySelector(".card-sub")?.textContent,
    corner: card.querySelector(".card-corner")?.textContent,
    notes: [...card.querySelectorAll(".card-note")].map((note) => note.textContent),
    focus: card.querySelector("[data-task-card-focus]")?.textContent,
    details: [...card.querySelectorAll(".task-card-detail")].map((detail) => detail.textContent),
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
  return [...container.querySelectorAll(".mention-chip")];
}

test("a plan's chip hangs the plan's card, and a section's the same card's head with the heading the anchor names", async () => {
  const container = await drawn(
    [
      mentionMarkdown({ kind: MENTION_KIND.TASK, taskId: PLAN_ID }, "the plan", PLACE),
      mentionMarkdown(
        { kind: MENTION_KIND.SECTION, taskId: PLAN_ID, anchor: "roll-it-out" },
        "rollout",
        PLACE,
      ),
      mentionMarkdown(
        { kind: MENTION_KIND.SECTION, taskId: PLAN_ID, anchor: "pricing" },
        "Pricing",
        PLACE,
      ),
      `[v4](${HOME}/plan/${PLAN_ID}/version/4)`,
    ].join(" "),
  );
  const [plan, section, gone, version] = chipsOf(container);

  const planCard = await cardOf(plan);
  const sectionCard = await cardOf(section);

  assert.equal(planCard.card, "data-task-card");
  assert.equal(planCard.name, PLAN.name);
  assert.deepEqual(planCard.details, ["acme/relay"]);
  assert.equal(planCard.focus, undefined);
  assert.equal(sectionCard.card, "data-task-card");
  assert.equal(sectionCard.name, PLAN.name);
  assert.equal(sectionCard.focus, "Roll it out");
  assert.equal((await cardOf(gone)).focus, "Pricing · No longer in the plan");
  assert.equal((await cardOf(version)).focus, "Version 4");
});

test("a page's chip hangs its title, its version, and when it moved; one the window holds nothing of, or one of another plan, keeps the chip's own card", async () => {
  const container = await drawn(
    [
      mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: PLAN_ID, pageId: PAGE_ID }, "", PLACE),
      mentionMarkdown(
        {
          kind: MENTION_KIND.PAGE,
          taskId: PLAN_ID,
          pageId: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
        },
        "Old draft",
        PLACE,
      ),
      mentionMarkdown(
        {
          kind: MENTION_KIND.PAGE,
          taskId: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
          pageId: PAGE_ID,
        },
        "Another plan's page",
        PLACE,
      ),
    ].join(" "),
  );
  const [held, unheld, elsewhere] = chipsOf(container);

  const page = await cardOf(held);
  const other = await cardOf(unheld);
  const another = await cardOf(elsewhere);

  assert.equal(page.card, "data-page-card");
  assert.equal(page.name, "Unfurl matrix");
  assert.equal(page.sub, "Version 3");
  assert.ok(page.corner, "the corner says when the page last moved");
  assert.equal(other.card, "data-mention-card");
  assert.equal(other.name, "Old draft");
  // A page id the open plan holds, named on another plan, is not the open plan's page.
  assert.equal(another.card, "data-mention-card");
  assert.equal(another.name, "Another plan's page");
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

test("a member's chip hangs their card, and an Inbox item's its question and that it waits", async () => {
  const container = await drawn(
    `Ask [Sam](${HOME}/person/${SAM}) about [the links](${HOME}/plan/${PLAN_ID}/inbox/${ITEM_ID}).`,
  );
  const [person, item] = chipsOf(container);

  const member = await cardOf(person);
  const question = await cardOf(item);

  assert.equal(member.card, "data-actor-card");
  assert.equal(member.name, "Sam Okafor");
  assert.equal(member.sub, "sam@example.com");
  assert.equal(question.card, "data-inbox-item-card");
  assert.equal(question.name, "Keep expired links?");
  assert.deepEqual(question.notes, ["Waiting for an answer"]);
});

test("an automation's chip hangs its card, the workspace's automations read only once the card is hung", async () => {
  const container = await drawn(`Run by [the sweep](${HOME}/automation/${SWEEP.id}).`);
  const reads = () => told.filter((request) => request.kind === ACT_KIND.AUTOMATIONS_LIST).length;
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
