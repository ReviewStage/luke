// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Plan } from "@luke/features/plan-wire";
import type { PlanningRepositoriesAnswer } from "@luke/features/planning-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { repositoryLabel } from "@luke/ui/task-list-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { MemberDirectory } from "../member-directory";
import type { PlanEditorHandle } from "../plan-editor/contract";
import { mountPlanEditor } from "../plan-editor/plan-editor";
import { PlanBody } from "./plan-body";
import { PlanCrumb } from "./plan-crumb";
import { TRANSCRIPT_CODE_AND_TABLE_COMPONENTS } from "./transcript-markdown";

/**
 * The plan's document at the widths a column leaves it: however narrow, the
 * crumb wraps rather than cutting its names to a letter, and who can edit is
 * never cut; the "Edited by" line wraps rather than squeezing a name to
 * nothing; the title breaks only a word wider than the column, at a smaller
 * size in a narrow one; a list item breaks a long path at the edge; and a
 * table, read or edited, keeps each word whole and scrolls, fading the edge
 * it hides columns past, as an agent's transcript's table does. jsdom lays
 * nothing out, so each width is the stylesheets' container queries resolved
 * for a column that wide (`#testing/container-width`). Synthetic throughout.
 */

/** The document's column at the floors the window reaches, and at its comfortable width. */
const COLUMN = {
  /** Beside the widest sidebar and side panel. */
  NARROWEST: 280,
  /** The least window with the side panel dragged widest. */
  NARROW: 423,
  WIDE: 720,
} as const;

const LONG_WORKSPACE: Workspace = {
  id: "workspace-northwind",
  name: "Northwind Platform Infrastructure",
  slug: "northwind",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 3,
};

const GRACE = { userId: "user-grace", name: "Grace Hopper-Montgomery" };

const MEMBERS: readonly WorkspaceMember[] = [
  { ...GRACE, email: "grace@example.com", role: WORKSPACE_ROLE.OWNER },
  {
    userId: "user-ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: WORKSPACE_ROLE.ADMIN,
  },
  {
    userId: "user-kat",
    name: "Kat Johnson",
    email: "kat@example.com",
    role: WORKSPACE_ROLE.MEMBER,
  },
];

const BODY = [
  "## Approach",
  "- Follow `src/members/remove-member-from-workspace-and-revoke-every-session.ts` for the shape.",
  "## Rollout",
  '| Case | Result |\n| --- | --- |\n| Link opened twice | `InviteError("no-longer-valid")` |',
].join("\n\n");

/** A plan with a long name, a list, and a table, last written by Luke on Grace's call. */
const PLAN: Plan = {
  ...DOCUMENT_PLAN,
  name: "Let members invite teammates by email with expiring single-use links",
  repository: "northwind-platform/customer-identity-and-access-management-service",
  document: { body: BODY, assumptions: [] },
  lastEdit: { actor: PLAN_ACTOR.NOTETAKER, duringCall: true, by: GRACE, at: Date.now() },
};

let root: Root | undefined;
const editors: PlanEditorHandle[] = [];

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The plan's document, its crumb over it, drawn in a column `width` pixels wide, as the window draws it. */
async function drawnAt(width: number): Promise<HTMLElement> {
  layContainersAt({ "plan-document": width });
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
  const column = document.body.appendChild(document.createElement("section"));
  column.className = "desktop-document";
  root = createRoot(column);
  const crumb = createElement(PlanCrumb, {
    workspace: LONG_WORKSPACE,
    repository: PLAN.repository,
    archived: false,
    doors: {
      personal: false,
      onOpenWorkspace: () => undefined,
      repository: {
        label: (named) => repositoryLabel(named, []),
        pictures: false,
        read: () => new Promise<PlanningRepositoriesAnswer>(() => undefined),
      },
    },
  });
  const body = createElement(PlanBody, {
    plan: PLAN,
    live: false,
    reader: { readerId: undefined },
    crumb,
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MemberDirectory, {
          workspace: LONG_WORKSPACE,
          readerId: undefined,
          children: body,
        }),
      ),
    ),
  );
  await settle();
  return column;
}

/** The first element under `scope` that `selector` names, which the document must draw. */
function find(scope: ParentNode, selector: string): HTMLElement {
  return scope.querySelector<HTMLElement>(selector) ?? assert.fail(`${selector} is drawn`);
}

/** The size, in ems of the text around it, the title is drawn at. */
function titleEms(column: HTMLElement): number {
  return Number.parseFloat(
    getComputedStyle(find(column, ".plan-title .markdown-heading")).fontSize,
  );
}

test("a 720px column draws the crumb on one line, the names giving way before who can edit", async () => {
  const column = await drawnAt(COLUMN.WIDE);
  const crumb = find(column, 'nav[aria-label="Where this task is"]');

  assert.notEqual(getComputedStyle(crumb).flexWrap, "wrap");
  assert.equal(getComputedStyle(find(crumb, ".plan-crumb-people")).flexShrink, "0");
  assert.match(crumb.textContent ?? "", /3 can edit$/u);
});

test("a column under 480px wraps the crumb, the separator and the repository together, rather than cutting the names to a letter", async () => {
  for (const width of [COLUMN.NARROWEST, COLUMN.NARROW]) {
    const column = await drawnAt(width);
    const crumb = find(column, 'nav[aria-label="Where this task is"]');

    assert.equal(getComputedStyle(crumb).flexWrap, "wrap", `at ${width}px`);
    assert.equal(getComputedStyle(find(crumb, ".plan-crumb-people")).flexShrink, "0");
    const step = find(crumb, ".plan-crumb-step");
    assert.ok(
      step.querySelector(".plan-crumb-separator"),
      "the separator wraps with its repository",
    );
    assert.equal(step.textContent, "customer-identity-and-access-management-service");
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  }
});

test("the Edited by line wraps between its words and names at every width, so no name is squeezed to nothing", async () => {
  for (const width of [COLUMN.NARROWEST, COLUMN.WIDE]) {
    const column = await drawnAt(width);
    const line = find(column, ".plan-edit-note");

    assert.equal(getComputedStyle(line).flexWrap, "wrap", `at ${width}px`);
    assert.equal(line.querySelectorAll(".actor-ref").length, 2);
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  }
});

test("the title breaks only a word wider than the column, and steps down in a column under 400px", async () => {
  const wide = titleEms(await drawnAt(COLUMN.WIDE));
  act(() => root?.unmount());
  document.head.innerHTML = "";
  const narrow = await drawnAt(COLUMN.NARROWEST);
  const title = find(narrow, ".plan-title .markdown-heading");

  assert.equal(getComputedStyle(title).overflowWrap, "break-word");
  assert.ok(titleEms(narrow) < wide, `${titleEms(narrow)}em under ${wide}em`);
});

test("a list item breaks a long path at the column's edge, and a table cell keeps its words whole so the table scrolls", async () => {
  const column = await drawnAt(COLUMN.NARROWEST);
  const item = find(column, ".markdown li");
  const cell = find(column, ".markdown td");

  assert.ok(item.querySelector("code"), "the path is code in a tight item, with no paragraph");
  assert.equal(getComputedStyle(item).overflowWrap, "anywhere");
  assert.notEqual(getComputedStyle(cell).overflowWrap, "anywhere");
  assert.equal(getComputedStyle(find(column, ".markdown table")).overflowX, "auto");
});

test("a table opened in the plan's editor keeps each cell's words whole, as the read view does, rather than breaking them anywhere", () => {
  layContainersAt({ "plan-document": COLUMN.NARROWEST });
  const host = document.body.appendChild(document.createElement("div"));
  const editor = mountPlanEditor(host, {
    markdown: `${BODY}\n`,
    placement: { section: 1 },
    focus: false,
    label: "Plan",
    className: "markdown plan-unit",
    onDraft: () => undefined,
    onFinish: () => undefined,
    onLeaveUp: () => undefined,
  });
  editors.push(editor);
  const words = find(host, "td > p");

  assert.equal(getComputedStyle(find(host, "p")).overflowWrap, "anywhere");
  assert.equal(getComputedStyle(words).overflowWrap, "normal");
});

test("a table, in the plan or in an agent's transcript, fades the edges it hides columns past on its own sideways scroll, so a cut column reads as one to scroll to", async () => {
  const column = await drawnAt(COLUMN.NARROWEST);
  const Table =
    TRANSCRIPT_CODE_AND_TABLE_COMPONENTS.table ?? assert.fail("a transcript draws tables");
  const transcript = document.body.appendChild(document.createElement("div"));
  const transcriptRoot = createRoot(transcript);
  act(() => transcriptRoot.render(createElement(Table, { children: null })));

  for (const table of [find(column, ".markdown table"), find(transcript, ".transcript-table")]) {
    const style = getComputedStyle(table);
    assert.equal(style.overflowX, "auto");
    assert.match(style.getPropertyValue("animation-timeline"), /^scroll\(self inline\)/u);
    assert.match(style.getPropertyValue("mask-image"), /--table-fade-end/u);
  }
  act(() => transcriptRoot.unmount());
});
