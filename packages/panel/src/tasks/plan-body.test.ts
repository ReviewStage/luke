// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { PLAN_ACTOR, type PlanLastEdit, type Task } from "@luke/features/task-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { lineWords } from "../testing/actor-line.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handState, signedInAs } from "../testing/app-state.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import type { EditAgents } from "./edit-ref.js";
import { PlanBody } from "./plan-body.js";
import type { TaskLooks } from "./use-task-looks.js";

/**
 * plan-body.test.ts -- the open task's document says who created it and who last wrote it,
 * under its title and on each section, each writer on their own face hanging
 * their card, and the time opening the version history. Synthetic people.
 */

const TASK: Task = {
  ...DOCUMENT_TASK,
  document: { body: "## Goal\nInvite a teammate by email.", assumptions: [] },
};

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const LEE = { userId: "user-lee", name: "Lee Park" };
/** Who the workspace's work names but left, as the read of who left answers. */
const LEE_PICTURE = "https://lh3.googleusercontent.com/a/photo-7";
const FORMER = [{ ...LEE, pictureUrl: LEE_PICTURE }];

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 2,
};

const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...CHARLES, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
];

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix auth flow",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
};

let root: Root | undefined;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** What the document is drawn with beyond the plan: who reads it, its looks, its agents, and the history's door. */
interface Drawn {
  readonly readerId?: string;
  readonly looks?: TaskLooks;
  readonly agents?: EditAgents;
  readonly onShowHistory?: (save: number | undefined) => void;
  /** The account signed in on this Mac, as main's document names it; none where the test names nobody. */
  readonly account?: { readonly id: string; readonly email: string; readonly name: string };
  /** The task's own page, where each section and the title carry a ⋯. */
  readonly sectionLinks?: NonNullable<React.ComponentProps<typeof PlanBody>["sectionLinks"]>;
}

/** The plan drawn in a workspace whose members read answers `MEMBERS`, as `drawn` says. */
async function draw(task: Task, drawn: Drawn = {}): Promise<HTMLElement> {
  fakeAppBridge({
    act: (): Promise<ActOutcome> =>
      Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve(MEMBERS),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve(FORMER),
  });
  if (drawn.account !== undefined) handState({}, { account: signedInAs(drawn.account).account });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const { readerId, account: _account, ...rest } = drawn;
  const body = createElement(PlanBody, {
    task,
    live: false,
    reader: { readerId },
    ...rest,
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MemberDirectory, { workspace: ACME, readerId, children: body }),
      ),
    ),
  );
  await settle();
  return container;
}

/** `PLAN` as last edited as `edit` says, now, over the document and on its Goal section. */
function editedAs(edit: Omit<PlanLastEdit, "at">, at = Date.now()): Task {
  return { ...TASK, lastEdit: { ...edit, at }, sectionEdits: [{ section: "Goal", ...edit, at }] };
}

/** The words of the line over the document and of the Goal section's byline, as a screen reader reads them. */
function editedLines(view: HTMLElement): (string | undefined)[] {
  return [
    lineWords(view.querySelector(".plan-byline-edited")),
    lineWords(view.querySelector(".plan-unit-byline")),
  ];
}

/** The words a line shows, what only a screen reader hears left out. */
function shownWords(line: Element | null): string | undefined {
  const copy = line?.cloneNode(true);
  if (!(copy instanceof Element)) return undefined;
  for (const hidden of copy.querySelectorAll(".visually-hidden, .luke-visually-hidden"))
    hidden.remove();
  return lineWords(copy);
}

/** The card hung once the first of `selector` in the line over the document, or in `line`, is hovered. */
function cardOf(
  view: HTMLElement,
  selector = "[data-actor-ref]",
  line = ".plan-byline-edited",
): HTMLElement {
  const anchor = view.querySelector(`${line} ${selector}`) ?? assert.fail("the ref stands");
  act(() => {
    anchor.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return document.querySelector<HTMLElement>(".luke-tooltip-card") ?? assert.fail("the card hangs");
}

test("the saved body is drawn as Markdown", () => {
  const markup = renderToStaticMarkup(createElement(PlanBody, { task: TASK, live: false }));

  assert.match(markup, /<p class="markdown-heading" data-level="2">Goal<\/p>/u);
  assert.match(markup, /Invite a teammate by email\./u);
});

test("under its title the plan says who created the task and when, then who last edited it and when, and a plan nobody edited says only who created it", async () => {
  // Note that only the date is fixed, so the plan's minute reads `now` and nothing waits on a timer.
  const now = Date.UTC(2026, 9, 14, 12);
  vi.useFakeTimers({ now, toFake: ["Date"] });
  const day = 24 * 60 * 60 * 1000;
  const started = { ...TASK, createdAt: now - 3 * day, createdBy: CHARLES };
  const edited = {
    ...started,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: DEAN, at: now },
  };
  // A reader the members read does not list, signed in on this Mac, whose task the service names by its owner's id alone.
  const GRACE = { id: "user-grace", email: "grace@example.com", name: "Grace Hopper" };
  const { createdBy: _named, ...byOwnerAlone } = { ...started, ownerId: GRACE.id };

  const view = await draw(edited, { readerId: DEAN.userId });
  const byline = view.querySelector(".plan-byline");
  const unedited = await draw(started, { readerId: DEAN.userId });
  const own = await draw(byOwnerAlone, { readerId: GRACE.id, account: GRACE });

  assert.equal(
    byline?.previousElementSibling?.textContent,
    TASK.name,
    "the line stands under the title",
  );
  assert.deepEqual([...(byline?.querySelectorAll(".actor-line") ?? [])].map(lineWords), [
    "Created by Charles Pan · 3d ago",
    "Last edited by you · now",
  ]);
  assert.deepEqual([...unedited.querySelectorAll(".plan-byline .actor-line")].map(lineWords), [
    "Created by Charles Pan · 3d ago",
  ]);
  assert.equal(
    lineWords(own.querySelector(".plan-byline .actor-line")),
    "Created by you · 3d ago",
    "a task named by its owner's id alone is the reader's own",
  );
});

test("two members each see the other's edits under the other's name on their face, and only their own as you", async () => {
  const byDean = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: DEAN };
  const byCharles = { ...byDean, by: CHARLES };

  const charles = await draw(editedAs(byCharles), { readerId: DEAN.userId });
  assert.deepEqual(editedLines(charles), ["Last edited by Charles Pan · now", "Charles Pan now"]);
  assert.equal(charles.querySelector(".plan-byline-edited .actor-mark")?.textContent, "C");

  assert.deepEqual(editedLines(await draw(editedAs(byDean), { readerId: CHARLES.userId })), [
    "Last edited by Dean Stratakos · now",
    "Dean Stratakos now",
  ]);
  assert.deepEqual(editedLines(await draw(editedAs(byDean), { readerId: DEAN.userId })), [
    "Last edited by you · now",
    "You now",
  ]);
});

test("Luke's notes on a teammate's call name whose call it was, the teammate on their face, and the reader's own as words", async () => {
  const onCharlesCall = { actor: PLAN_ACTOR.NOTETAKER, duringCall: true, by: CHARLES };

  const dean = await draw(editedAs(onCharlesCall), { readerId: DEAN.userId });
  assert.deepEqual(editedLines(dean), [
    "Last edited by Luke during Charles Pan’s call · now",
    "Luke during Charles Pan’s call now",
  ]);
  assert.deepEqual(
    [...dean.querySelectorAll(".plan-byline-edited .actor-mark")].map((mark) =>
      mark.getAttribute("data-kind"),
    ),
    ["luke", "person"],
  );

  const charles = await draw(editedAs(onCharlesCall), { readerId: CHARLES.userId });
  assert.deepEqual(editedLines(charles), [
    "Last edited by Luke during your call · now",
    "Luke during your call now",
  ]);
  assert.equal(charles.querySelectorAll(".plan-byline-edited .actor-mark").length, 1);
});

test("an edit the service names no member for, or read without an account id, is never yours, and a member who left keeps their face and is heard as having left", async () => {
  const unnamed = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false };

  assert.equal(
    editedLines(await draw(editedAs(unnamed), { readerId: DEAN.userId }))[0],
    "Last edited by someone · now",
  );
  assert.equal(
    editedLines(await draw(editedAs({ ...unnamed, by: DEAN })))[0],
    "Last edited by Dean Stratakos · now",
  );
  const former = await draw(editedAs({ ...unnamed, by: LEE }), { readerId: DEAN.userId });
  assert.equal(editedLines(former)[0], "Last edited by Lee Park (former member) · now");
  const mark = former.querySelector(".plan-byline-edited .actor-mark");
  assert.equal(mark?.querySelector("img")?.getAttribute("src"), LEE_PICTURE);
});

test("the time opens the version history, on the plan as it stands or on the section's last save, and the writer opens nothing", async () => {
  const shown: (number | undefined)[] = [];
  const at = Date.now() - 2 * 60 * 60 * 1000;
  const view = await draw(
    editedAs({ actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: CHARLES }, at),
    { readerId: DEAN.userId, onShowHistory: (save) => shown.push(save) },
  );
  const times = [
    ...view.querySelectorAll<HTMLButtonElement>('button[aria-label$="Show version history"]'),
  ];

  assert.deepEqual(
    times.map((time) => [time.textContent, time.getAttribute("aria-label")]),
    [
      ["2h ago", "Edited 2h ago. Show version history"],
      ["2h", "Goal: edited 2h ago. Show version history"],
    ],
  );
  assert.equal(view.querySelector(".plan-byline-edited [data-actor-ref]")?.tagName, "SPAN");
  for (const time of times) act(() => time.click());
  assert.deepEqual(shown, [undefined, at]);
});

test("a section's byline shows only the writer's face and a few letters of time, so it keeps to its heading's end, and its card says the rest", async () => {
  const onCharlesCall = { actor: PLAN_ACTOR.NOTETAKER, duringCall: true, by: CHARLES };
  const lastYear = new Date(new Date().getFullYear() - 1, 9, 1).getTime();
  const old = await draw(editedAs({ ...onCharlesCall, duringCall: false }, lastYear));
  assert.equal(
    shownWords(old.querySelector(".plan-unit-byline")),
    " Oct 1",
    "a date, its year left out",
  );
  act(() => root?.unmount());

  const view = await draw(editedAs(onCharlesCall), { readerId: DEAN.userId });
  const byline = view.querySelector(".plan-unit-byline");
  assert.equal(shownWords(byline), " now");
  assert.equal(byline?.querySelectorAll(".actor-mark").length, 1, "the call's owner is not faced");
  assert.match(
    cardOf(view, "[data-actor-ref]", ".plan-unit-byline").textContent ?? "",
    /^LukeDuring Charles Pan’s call · now/u,
  );
});

test("a teammate's card says who they are and what they last changed in the plan", async () => {
  const at = Date.now();
  const task: Task = {
    ...TASK,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
    sectionEdits: [
      { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
      { section: "Rollout", actor: PLAN_ACTOR.NOTETAKER, by: DEAN, at, duringCall: true },
      { section: "Risks", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
    ],
  };
  const card = cardOf(await draw(task, { readerId: DEAN.userId }));

  assert.ok(card.querySelector('[data-actor-card="person"]'), "a person's card hangs");
  assert.match(card.textContent ?? "", /Charles Pancharles@example\.comMember/u);
  assert.match(card.textContent ?? "", /Edited Goal and Risks · now$/u);
});

test("Luke's card says whose call he wrote on, and what he wrote", async () => {
  const at = Date.now();
  const onCharlesCall = { actor: PLAN_ACTOR.NOTETAKER, by: CHARLES, at, duringCall: true };
  const task: Task = {
    ...TASK,
    lastEdit: onCharlesCall,
    sectionEdits: [
      { section: "Goal", ...onCharlesCall },
      { section: "Risks", ...onCharlesCall },
    ],
  };
  const card = cardOf(await draw(task, { readerId: DEAN.userId }));

  assert.ok(card.querySelector('[data-actor-card="luke"]'), "Luke's card hangs");
  assert.match(
    card.textContent ?? "",
    /^LukeDuring Charles Pan’s call · nowEdited Goal and Risks$/u,
  );
});

test("an agent the plan's list holds wears its harness, hangs its tab's card, and opens its tab; one it does not hold is named alone", async () => {
  const opened: string[] = [];
  const byAgent = editedAs({
    actor: PLAN_ACTOR.AGENT,
    label: "Fix auth flow",
    agentId: AGENT.id,
    duringCall: false,
  });
  const agents: EditAgents = {
    control: codingAgentsControl({ agents: [AGENT] }),
    onOpen: (agentId) => opened.push(agentId),
  };
  const view = await draw(byAgent, { readerId: DEAN.userId, agents });
  const ref = view.querySelector<HTMLElement>(".plan-byline-edited [data-actor-ref]");

  assert.equal(editedLines(view)[0], "Last edited by Fix auth flow · now");
  assert.equal(ref?.tagName, "BUTTON");
  assert.ok(view.querySelector('.plan-byline-edited .actor-mark[data-kind="agent"] .state-glyph'));
  assert.equal(cardOf(view).querySelector(".luke-hover-card-name")?.textContent, "Fix auth flow");
  act(() => ref?.click());
  assert.deepEqual(opened, [AGENT.id]);

  const unlisted = await draw(byAgent, {
    readerId: DEAN.userId,
    agents: { ...agents, control: codingAgentsControl() },
  });
  assert.equal(unlisted.querySelector(".plan-byline-edited [data-actor-ref]")?.tagName, "SPAN");
});

test("the sections changed since the last look are counted beside a face for each who changed them", async () => {
  const at = Date.now();
  const task: Task = {
    ...TASK,
    sectionEdits: [
      { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
      { section: "Rollout", actor: PLAN_ACTOR.NOTETAKER, by: CHARLES, at, duringCall: true },
      { section: "Risks", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
    ],
  };
  let dismissed = 0;
  const looks: TaskLooks = {
    changed: new Set(["Goal", "Rollout", "Risks"]),
    dismiss: () => (dismissed += 1),
  };
  const view = await draw(task, { readerId: DEAN.userId, looks });
  const line = view.querySelector(".plan-changed-note") ?? assert.fail("the line stands");

  assert.match(lineWords(line) ?? "", /^Changed since you last looked · 3 sections by /u);
  assert.deepEqual(
    [...line.querySelectorAll(".actor-stack .actor-mark")].map((mark) =>
      mark.getAttribute("data-kind"),
    ),
    ["person", "luke"],
  );
  assert.equal(line.querySelector(".visually-hidden")?.textContent, "Charles Pan, Luke");
  act(() => line.querySelector("button")?.click());
  assert.equal(dismissed, 1);
});

test("a title long enough to fill its line wraps short of its ⋯, as a section's heading wraps short of its own", async () => {
  const sheets = layContainersAt({});
  const view = await draw(
    { ...TASK, name: "A plan whose name runs on long enough to fill the whole line it stands on" },
    {
      sectionLinks: {
        workspace: "acme",
        onOpen: () => undefined,
        onOpenFile: () => undefined,
        reveal: undefined,
      },
    },
  );
  const title = view.querySelector(".plan-unit-attributed .task-title > .markdown-heading");
  const titleRow = title?.closest(".plan-unit-attributed")?.querySelector(".plan-unit-more");
  // Note that jsdom resolves no custom property, so the room reads as the length it is declared by.
  const room = title === null || title === undefined ? "" : getComputedStyle(title).paddingRight;
  sheets.remove();

  assert.ok(titleRow, "the title carries its ⋯");
  assert.doesNotMatch(room, /^(0(px)?)?$/u, "the title keeps room at its line's end");
});
