// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_BRIEF, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { PLAN_ACTOR, type PlanLastEdit, type Task } from "@repo/features/task-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { EXPERIMENT, type ExperimentChoices } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { lineWords } from "../testing/actor-line.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import {
  handMembers,
  handState,
  readExperiments,
  registryWith,
  signedInAs,
} from "../testing/app-state.js";
import { onRegistry, withQueryClient } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { restOn } from "../testing/hint-rest.js";
import { agentsControl } from "../testing/tasks-control.js";
import type { EditAgents } from "./edit-ref.js";
import { PlanBody } from "./plan-body.js";
import { planEditMutation } from "./plan-edit-mutation.js";
import type { TaskLooks } from "./use-task-looks.js";

// Note that the plan's document, comments, and history stand only while the account has Plans on.
beforeAll(() => readExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS)));
// Note that each case starts with the document handing Plans on, whatever an earlier case handed.
beforeEach(() => handState(experimentsOn(EXPERIMENT.DESCRIPTIONS)));

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

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix auth flow",
  createdAt: 1_000,
  status: AGENT_STATUS.RUNNING,
  turnId: null,
  brief: AGENT_BRIEF.PROMPT,
};

/**
 * Every root a test drew into, latest last. Note that each is unmounted once
 * the test ends, not only the latest, because a root left standing stays
 * subscribed to the window's state and commits on a later delivery, after
 * the file's window is gone.
 */
const roots: Root[] = [];

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** A root over `container`, unmounted once the test ends. */
function mountRoot(container: HTMLElement): Root {
  const root = createRoot(container);
  roots.push(root);
  return root;
}

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
  /** The account's experiments, Plans alone on where none are named. */
  readonly experiments?: ExperimentChoices;
}

/** The plan drawn in a workspace whose people the host holds as `MEMBERS` and `FORMER`, as `drawn` says. */
async function draw(task: Task, drawn: Drawn = {}): Promise<HTMLElement> {
  fakeAppBridge({});
  fakeActPort({});
  const experiments = drawn.experiments ?? experimentsOn(EXPERIMENT.DESCRIPTIONS);
  handState(
    experiments,
    drawn.account === undefined ? {} : { account: signedInAs(drawn.account).account },
  );
  handMembers(() => ({ rows: { members: MEMBERS, former: FORMER } }));
  const container = document.body.appendChild(document.createElement("div"));
  const root = mountRoot(container);
  const { readerId, account: _account, experiments: _experiments, ...rest } = drawn;
  const body = createElement(PlanBody, {
    task,
    reader: { readerId },
    ...rest,
  });
  act(() =>
    root.render(
      onRegistry(
        registryWith(experiments),
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
  for (const hidden of copy.querySelectorAll(".ui-visually-hidden, .ui-visually-hidden"))
    hidden.remove();
  return lineWords(copy);
}

/** The card hung once the first of `selector` in the Goal section's byline, or in `line`, is hovered. */
function cardOf(
  view: HTMLElement,
  selector = "[data-actor-ref]",
  line = ".plan-unit-byline",
): HTMLElement {
  const anchor = view.querySelector(`${line} ${selector}`) ?? assert.fail("the ref stands");
  restOn(anchor);
  return document.querySelector<HTMLElement>(".ui-tooltip-card") ?? assert.fail("the card hangs");
}

test("the saved body is drawn as Markdown", () => {
  const markup = renderToStaticMarkup(withQueryClient(createElement(PlanBody, { task: TASK })));

  assert.match(markup, /<p class="ui-markdown-heading" data-level="2">Goal<\/p>/u);
  assert.match(markup, /Invite a teammate by email\./u);
});

test("under its title the plan says who created the task and when, then when it was last edited, and a plan nobody edited says only who created it", async () => {
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
    "Edited now",
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

test("while Plans is off the task's title stands with who created it and none of the plan: no edit, no section, no changed line", async () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const edit = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: DEAN, at: now };
  const edited: Task = {
    ...TASK,
    createdAt: now - 3 * day,
    createdBy: CHARLES,
    lastEdit: edit,
    sectionEdits: [{ section: "Goal", ...edit }],
  };
  const looks: TaskLooks = { changed: new Set(["Goal"]), dismiss: () => undefined };

  const view = await draw(edited, { readerId: DEAN.userId, looks, experiments: {} });

  const byline = view.querySelector(".plan-byline");
  assert.equal(byline?.previousElementSibling?.textContent, TASK.name);
  assert.deepEqual([...(byline?.querySelectorAll(".actor-line") ?? [])].map(lineWords), [
    "Created by Charles Pan · 3d ago",
  ]);
  assert.ok(!view.textContent?.includes("Invite a teammate by email."), "no section is drawn");
  assert.ok(!view.textContent?.includes("Changed since you last looked"), "no changed line");
});

test("two members each see the other's edits under the other's name on their face, and only their own as you", async () => {
  const byDean = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: DEAN };
  const byCharles = { ...byDean, by: CHARLES };

  const charles = await draw(editedAs(byCharles), { readerId: DEAN.userId });
  assert.deepEqual(editedLines(charles), ["Edited now", "Charles Pan now"]);
  assert.equal(charles.querySelector(".plan-unit-byline .actor-mark")?.textContent, "C");

  assert.deepEqual(editedLines(await draw(editedAs(byDean), { readerId: CHARLES.userId })), [
    "Edited now",
    "Dean Stratakos now",
  ]);
  assert.deepEqual(editedLines(await draw(editedAs(byDean), { readerId: DEAN.userId })), [
    "Edited now",
    "You now",
  ]);
});

test("an edit the service names no member for, or read without an account id, is never yours, and a member who left keeps their face and is heard as having left", async () => {
  const unnamed = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false };

  assert.equal(
    editedLines(await draw(editedAs(unnamed), { readerId: DEAN.userId }))[1],
    "Someone now",
  );
  assert.equal(
    editedLines(await draw(editedAs({ ...unnamed, by: DEAN })))[1],
    "Dean Stratakos now",
  );
  const former = await draw(editedAs({ ...unnamed, by: LEE }), { readerId: DEAN.userId });
  assert.equal(editedLines(former)[1], "Lee Park (former member) now");
  const mark = former.querySelector(".plan-unit-byline .actor-mark");
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
  assert.equal(view.querySelector(".plan-unit-byline [data-actor-ref]")?.tagName, "SPAN");
  for (const time of times) act(() => time.click());
  assert.deepEqual(shown, [undefined, at]);
});

test("a section's byline shows only the writer's face and a few letters of time, so it keeps to its heading's end, and its card says the rest", async () => {
  const byApp = { actor: PLAN_ACTOR.NOTETAKER, duringCall: false, by: CHARLES };
  const lastYear = new Date(new Date().getFullYear() - 1, 9, 1).getTime();
  const old = await draw(editedAs(byApp, lastYear));
  assert.equal(
    shownWords(old.querySelector(".plan-unit-byline")),
    " Oct 1",
    "a date, its year left out",
  );
  act(() => roots.at(-1)?.unmount());

  const view = await draw(editedAs(byApp), { readerId: DEAN.userId });
  const byline = view.querySelector(".plan-unit-byline");
  assert.equal(shownWords(byline), " now");
  assert.equal(byline?.querySelectorAll(".actor-mark").length, 1);
  assert.match(
    cardOf(view, "[data-actor-ref]", ".plan-unit-byline").textContent ?? "",
    /^Vespinnow/u,
  );
});

test("a teammate's card says who they are and what they last changed in the plan", async () => {
  const at = Date.now();
  const task: Task = {
    ...TASK,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
    sectionEdits: [
      { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
      { section: "Rollout", actor: PLAN_ACTOR.NOTETAKER, by: DEAN, at, duringCall: false },
      { section: "Risks", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
    ],
  };
  const card = cardOf(await draw(task, { readerId: DEAN.userId }));

  assert.ok(card.querySelector('[data-actor-card="person"]'), "a person's card hangs");
  assert.match(card.textContent ?? "", /Charles Pancharles@example\.com · Member/u);
  assert.match(card.textContent ?? "", /Edited Goal and Risks · now$/u);
});

test("Vespin's card says when it wrote, and what it wrote", async () => {
  const at = Date.now();
  const byApp = { actor: PLAN_ACTOR.NOTETAKER, by: CHARLES, at, duringCall: false };
  const task: Task = {
    ...TASK,
    lastEdit: byApp,
    sectionEdits: [
      { section: "Goal", ...byApp },
      { section: "Risks", ...byApp },
    ],
  };
  const card = cardOf(await draw(task, { readerId: DEAN.userId }));

  assert.ok(card.querySelector('[data-actor-card="app"]'), "Vespin's card hangs");
  assert.match(card.textContent ?? "", /^VespinnowEdited Goal and Risks$/u);
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
    control: agentsControl({ agents: [AGENT] }),
    onOpen: (agentId) => opened.push(agentId),
  };
  const view = await draw(byAgent, { readerId: DEAN.userId, agents });
  const ref = view.querySelector<HTMLElement>(".plan-unit-byline [data-actor-ref]");

  assert.equal(editedLines(view)[1], "Fix auth flow now");
  assert.equal(ref?.tagName, "BUTTON");
  assert.ok(view.querySelector('.plan-unit-byline .actor-mark[data-kind="agent"] .state-glyph'));
  assert.equal(cardOf(view).querySelector(".ui-hover-card-name")?.textContent, "Fix auth flow");
  act(() => ref?.click());
  assert.deepEqual(opened, [AGENT.id]);

  const unlisted = await draw(byAgent, {
    readerId: DEAN.userId,
    agents: { ...agents, control: agentsControl() },
  });
  assert.equal(unlisted.querySelector(".plan-unit-byline [data-actor-ref]")?.tagName, "SPAN");
});

test("the sections changed since the last look are counted beside a face for each who changed them", async () => {
  const at = Date.now();
  const task: Task = {
    ...TASK,
    sectionEdits: [
      { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
      { section: "Rollout", actor: PLAN_ACTOR.NOTETAKER, by: CHARLES, at, duringCall: false },
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
    ["person", "app"],
  );
  assert.equal(line.querySelector(".ui-visually-hidden")?.textContent, "Charles Pan, Vespin");
  act(() => line.querySelector("button")?.click());
  assert.equal(dismissed, 1);
});

test("a plan read and not edited names itself by one h1, its title, with its Copy link button at the end of its line", async () => {
  const view = await draw(TASK, {
    sectionLinks: {
      workspace: "acme",
      onOpen: () => undefined,
      onOpenFile: () => undefined,
      reveal: undefined,
    },
  });

  const headings = view.querySelectorAll("h1");
  const more = view.querySelector('.ui-page-header-actions [aria-label="Copy link"]');

  assert.equal(headings.length, 1, "the plan page names itself once");
  assert.equal(headings[0]?.textContent, TASK.name);
  assert.ok(
    more?.closest(".ui-page-header-actions"),
    "the title carries its Copy link button in the header's acts",
  );
  assert.equal(more?.closest("header")?.contains(headings[0] ?? null), true);
});

test("an empty plan that cannot be edited draws no line saying to write it", async () => {
  const view = await draw({ ...TASK, document: { body: "", assumptions: [] } });

  assert.ok(!view.textContent?.includes("Write the description"), "no line under the byline");
});

test("a save that writes a section above the one the keyboard stands on leaves Tab entering at that section", async () => {
  const opened: Task = {
    ...TASK,
    document: {
      body: "## Goal\nInvite a teammate by email.\n\n## Approach\nModel an invite as a pending membership.",
      assumptions: [],
    },
  };
  const saved: Task = {
    ...opened,
    document: {
      ...opened.document,
      body: `## Context\nIt came up in support.\n\n${opened.document.body}`,
    },
  };
  fakeAppBridge({});
  fakeActPort({});
  handState(experimentsOn(EXPERIMENT.DESCRIPTIONS));
  handMembers(() => ({ rows: { members: MEMBERS } }));
  const container = document.body.appendChild(document.createElement("div"));
  const root = mountRoot(container);
  const registry = registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS));
  const drawPlan = (task: Task) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(MemberDirectory, {
            workspace: ACME,
            readerId: undefined,
            children: createElement(PlanBody, {
              task,
              edit: planEditMutation(task.id, () =>
                Promise.reject(new Error("Nothing is saved here.")),
              ),
            }),
          }),
        ),
      ),
    );
  const entered = () =>
    [...container.querySelectorAll<HTMLElement>("[role='group'][aria-label]")]
      .filter((block) => block.tabIndex === 0)
      .map((block) => block.getAttribute("aria-label"));
  drawPlan(opened);
  await settle();
  const approach = container.querySelector<HTMLElement>("[aria-label='Approach']");
  act(() => approach?.focus());

  drawPlan(saved);
  await settle();

  assert.deepEqual(entered(), ["Approach"]);
});
