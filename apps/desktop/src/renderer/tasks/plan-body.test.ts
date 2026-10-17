// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { lineWords } from "#testing/actor-line";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_TASK } from "#testing/document-task";
import { codingAgentsControl } from "#testing/tasks-control";
import { MemberDirectory } from "../member-directory";
import type { EditAgents } from "./edit-ref";
import { PlanBody } from "./plan-body";
import type { TaskLooks } from "./use-task-looks";

/**
 * plan-body.test.ts -- the open plan's document says who last wrote it,
 * over its text and on each section, each writer on their own face hanging
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
/** The window's own stylesheet, which says what each mark stands on. */
const DESKTOP_CSS = readFileSync(path.join(import.meta.dirname, "../styles/desktop.css"), "utf8");

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
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
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
}

/** The plan drawn in a workspace whose members read answers `MEMBERS`, as `drawn` says. */
async function draw(task: Task, drawn: Drawn = {}): Promise<HTMLElement> {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS }
            : request.kind === ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ
              ? { status: ACT_OUTCOME_STATUS.DONE, value: FORMER }
              : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
        ),
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const { readerId, ...rest } = drawn;
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
    lineWords(view.querySelector(".plan-edit-note")),
    lineWords(view.querySelector(".plan-unit-byline")),
  ];
}

/** The words a line shows, what only a screen reader hears left out. */
function shownWords(line: Element | null): string | undefined {
  const copy = line?.cloneNode(true);
  if (!(copy instanceof Element)) return undefined;
  for (const hidden of copy.querySelectorAll(".visually-hidden")) hidden.remove();
  return lineWords(copy);
}

/** The card hung once the first of `selector` in the line over the document, or in `line`, is hovered. */
function cardOf(view: HTMLElement, selector = ".actor-ref", line = ".plan-edit-note"): HTMLElement {
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

test("two members each see the other's edits under the other's name on their face, and only their own as you", async () => {
  const byDean = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: DEAN };
  const byCharles = { ...byDean, by: CHARLES };

  const charles = await draw(editedAs(byCharles), { readerId: DEAN.userId });
  assert.deepEqual(editedLines(charles), ["Edited by Charles Pan · now", "Charles Pan now"]);
  assert.equal(charles.querySelector(".plan-edit-note .actor-mark")?.textContent, "C");

  assert.deepEqual(editedLines(await draw(editedAs(byDean), { readerId: CHARLES.userId })), [
    "Edited by Dean Stratakos · now",
    "Dean Stratakos now",
  ]);
  assert.deepEqual(editedLines(await draw(editedAs(byDean), { readerId: DEAN.userId })), [
    "Edited by you · now",
    "You now",
  ]);
});

test("Luke's notes on a teammate's call name whose call it was, the teammate on their face, and the reader's own as words", async () => {
  const onCharlesCall = { actor: PLAN_ACTOR.NOTETAKER, duringCall: true, by: CHARLES };

  const dean = await draw(editedAs(onCharlesCall), { readerId: DEAN.userId });
  assert.deepEqual(editedLines(dean), [
    "Edited by Luke during Charles Pan’s call · now",
    "Luke during Charles Pan’s call now",
  ]);
  assert.deepEqual(
    [...dean.querySelectorAll(".plan-edit-note .actor-mark")].map((mark) =>
      mark.getAttribute("data-kind"),
    ),
    ["luke", "person"],
  );

  const charles = await draw(editedAs(onCharlesCall), { readerId: CHARLES.userId });
  assert.deepEqual(editedLines(charles), [
    "Edited by Luke during your call · now",
    "Luke during your call now",
  ]);
  assert.equal(charles.querySelectorAll(".plan-edit-note .actor-mark").length, 1);
});

test("an edit the service names no member for, or read without an account id, is never yours, and a member who left keeps their face, grayed, and is heard as having left", async () => {
  const unnamed = { actor: PLAN_ACTOR.DEVELOPER, duringCall: false };

  assert.equal(
    editedLines(await draw(editedAs(unnamed), { readerId: DEAN.userId }))[0],
    "Edited by someone · now",
  );
  assert.equal(
    editedLines(await draw(editedAs({ ...unnamed, by: DEAN })))[0],
    "Edited by Dean Stratakos · now",
  );
  const former = await draw(editedAs({ ...unnamed, by: LEE }), { readerId: DEAN.userId });
  assert.equal(editedLines(former)[0], "Edited by Lee Park (former member) · now");
  const mark = former.querySelector(".plan-edit-note .actor-mark");
  assert.equal(mark?.getAttribute("data-left"), "true");
  assert.equal(mark?.querySelector("img")?.getAttribute("src"), LEE_PICTURE);
});

test("the time opens the version history, on the plan as it stands or on the section's last save, and the writer opens nothing", async () => {
  const shown: (number | undefined)[] = [];
  const at = Date.now() - 2 * 60 * 60 * 1000;
  const view = await draw(
    editedAs({ actor: PLAN_ACTOR.DEVELOPER, duringCall: false, by: CHARLES }, at),
    { readerId: DEAN.userId, onShowHistory: (save) => shown.push(save) },
  );
  const times = [...view.querySelectorAll<HTMLButtonElement>(".plan-edit-link")];

  assert.deepEqual(
    times.map((time) => [time.textContent, time.getAttribute("aria-label")]),
    [
      ["2h ago", "Edited 2h ago. Show version history"],
      ["2h", "Goal: edited 2h ago. Show version history"],
    ],
  );
  assert.equal(view.querySelector(".plan-edit-note .actor-ref")?.tagName, "SPAN");
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
    cardOf(view, ".actor-ref", ".plan-unit-byline").textContent ?? "",
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
  const ref = view.querySelector<HTMLElement>(".plan-edit-note .actor-ref");

  assert.equal(editedLines(view)[0], "Edited by Fix auth flow · now");
  assert.equal(ref?.tagName, "BUTTON");
  assert.ok(view.querySelector('.plan-edit-note .actor-mark[data-kind="agent"] .state-glyph'));
  assert.equal(cardOf(view).querySelector(".card-name")?.textContent, "Fix auth flow");
  act(() => ref?.click());
  assert.deepEqual(opened, [AGENT.id]);

  const unlisted = await draw(byAgent, {
    readerId: DEAN.userId,
    agents: { ...agents, control: codingAgentsControl() },
  });
  assert.equal(unlisted.querySelector(".plan-edit-note .actor-ref")?.tagName, "SPAN");
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

/** What a mark stands on as the window's stylesheet draws it: "none" where its glyph stands bare on the ground. */
function groundOf(mark: Element): string {
  if (document.head.querySelector("style") === null) {
    document.head.appendChild(document.createElement("style")).textContent = DESKTOP_CSS;
  }
  return getComputedStyle(mark).getPropertyValue("background");
}

/** The ground of each face beside "Changed since you last looked", by its kind. */
async function changedFaces(
  sectionEdits: NonNullable<Task["sectionEdits"]>,
): Promise<[string, string][]> {
  const looks: TaskLooks = {
    changed: new Set(sectionEdits.map(({ section }) => section)),
    dismiss: () => undefined,
  };
  const view = await draw({ ...TASK, sectionEdits }, { readerId: DEAN.userId, looks });
  const line = view.querySelector(".plan-changed-note") ?? assert.fail("the line stands");
  return [...line.querySelectorAll(".actor-mark")].map((mark) => [
    mark.getAttribute("data-kind") ?? "",
    groundOf(mark),
  ]);
}

test("Luke alone beside the sections changed since the last look stands bare, as he does in a line, and on his tile only where a face overlaps his", async () => {
  const at = Date.now();
  const byLuke = { actor: PLAN_ACTOR.NOTETAKER, by: CHARLES, at, duringCall: true } as const;

  assert.deepEqual(await changedFaces([{ section: "Goal", ...byLuke }]), [["luke", "none"]]);

  const [person, luke] = await changedFaces([
    { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
    { section: "Rollout", ...byLuke },
  ]);
  assert.equal(person?.[0], "person");
  assert.equal(luke?.[0], "luke");
  assert.notEqual(luke?.[1], "none");
});
