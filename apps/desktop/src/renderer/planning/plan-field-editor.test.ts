// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { EMPTY_PLAN_FIELDS, planBody } from "@sidecar/hosted/plan-template";
import { PLAN_FIELD, type Plan, type PlanFields } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, type PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import {
  FIELD_KIND,
  type FieldEditorModule,
  type FieldEditorProps,
  type FieldValue,
} from "../field-editor/contract";
import { PlanBody } from "./plan-body";

/**
 * The editor itself is TipTap in a bundle of its own (`../field-editor/`),
 * tested beside it. Here the document mounts a stand-in for that bundle at
 * its one boundary, `window.lukeFieldEditor`, and the tests speak as the
 * editor would: the words it hands over and its finish.
 */

const PROBLEM = "- Only an admin can add a member.";

const FIELDS: PlanFields = { ...EMPTY_PLAN_FIELDS, goal: { problem: PROBLEM, outcome: null } };

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: planBody({ name: "Teammate invitations" }, FIELDS), assumptions: [] },
  fields: FIELDS,
};

/** Every editor the document mounted, newest last, with what it was handed. */
const mounted: { props: FieldEditorProps; destroyed: boolean }[] = [];

/** The stand-in for the editor's bundle: it records what it is handed and draws nothing of its own. */
const STAND_IN: FieldEditorModule = {
  mount: (_host, props) => {
    const editor = { props, destroyed: false };
    mounted.push(editor);
    return {
      destroy: () => {
        editor.destroyed = true;
      },
    };
  },
};

// Set before any document renders, since the document reads the bundle once per window.
window.lukeFieldEditor = STAND_IN;

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  mounted.length = 0;
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** The document with an edit door that records each edit and answers from the script, in order. */
function mount(plan: Plan, answers: readonly PlanningEditAnswer[] = [{ saved: true }]) {
  const sent: PlanEditRequest[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const saved: PlanningEditAnswer = { saved: true };
  const onEdit = (request: PlanEditRequest) => {
    sent.push(request);
    return Promise.resolve(answers[sent.length - 1] ?? saved);
  };
  act(() => root.render(createElement(PlanBody, { plan, live: false, onEdit })));
  return { container, sent, root, onEdit };
}

/** A block of the document, by the field it holds. */
function block(container: HTMLElement, label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
  assert.ok(found, `the ${label} block`);
  return found;
}

function pressOn(element: HTMLElement, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** A block selected by the keyboard and edited with Return. */
function edit(container: HTMLElement, label: string): void {
  const selected = block(container, label);
  act(() => selected.focus());
  pressOn(selected, "Enter");
}

/** The editor open now, as the document handed it over. */
function open(): FieldEditorProps {
  const editor = mounted.filter((held) => !held.destroyed).at(-1);
  assert.ok(editor, "an open editor");
  return editor.props;
}

/** The words the editor hands over as the developer types. */
function type(value: FieldValue): void {
  act(() => open().onDraft(value));
}

/** Esc or ⌘↩ in the editor. */
function finish(): void {
  act(() => open().onFinish());
}

function text(words: string): FieldValue {
  return { kind: FIELD_KIND.TEXT, text: words };
}

function buttonText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  assert.ok(button, label);
  return button;
}

test("a document with no edit door, or from a service that sends no fields, offers no editor", () => {
  const { fields: _fields, ...unfielded } = PLAN;
  const { container } = mount(unfielded);

  assert.equal(container.querySelector(".plan-unit-editable"), null);
});

test("Return on a selected block opens its Markdown in place, its heading kept, under a block the recording does not capture", () => {
  const { container } = mount(PLAN);

  edit(container, "Problem");

  const editor = container.querySelector(".plan-field-editor");
  assert.ok(editor?.classList.contains("ph-no-capture"));
  assert.ok(editor?.textContent?.includes("Problem"));
  assert.deepEqual(open().value, text(PROBLEM));
  assert.equal(open().label, "Problem");
  assert.equal(open().at, undefined, "the keyboard's way in puts the caret at the end");
  assert.ok(block(container, "Outcome"), "the other fields stay blocks");
});

test("a click into a field's words opens it with the caret where the click landed", () => {
  const { container } = mount(PLAN);
  const words = [...container.querySelectorAll(".plan-unit-editable")].find((unit) =>
    unit.textContent?.includes("Only an admin"),
  );
  assert.ok(words, "the Problem's words");

  act(() => {
    words.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 48 }));
  });

  assert.deepEqual(open().at, { x: 120, y: 48 });
  assert.deepEqual(open().value, text(PROBLEM));
});

test("Esc saves the words from what the editor opened on, and closes once the save lands", async () => {
  const { container, sent } = mount(PLAN);
  edit(container, "Problem");

  type(text("- Only an owner can add a member.\n"));
  finish();
  await settle();

  assert.deepEqual(sent, [
    { field: PLAN_FIELD.PROBLEM, base: PROBLEM, value: "- Only an owner can add a member." },
  ]);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("the words handed over as the developer types save once, as their last words, on Esc", async () => {
  const { container, sent } = mount(PLAN);
  edit(container, "Problem");

  type(text("- Only an"));
  type(text("- Only an owner"));
  type(text("- Only an owner can add a member."));
  finish();
  await settle();

  assert.deepEqual(
    sent.map(({ value }) => value),
    ["- Only an owner can add a member."],
  );
});

test("an editor closed with nothing changed saves nothing", async () => {
  const { container, sent } = mount(PLAN);
  edit(container, "Outcome");

  finish();
  await settle();

  assert.deepEqual(sent, []);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("a conflict keeps the editor open on the developer's words; Keep mine saves them over Luke's", async () => {
  const lukes = "- Only an admin or an owner can add a member.";
  const { container, sent } = mount(PLAN, [{ conflict: { current: lukes } }, { saved: true }]);
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));
  finish();
  await settle();

  assert.ok(container.textContent?.includes("Luke changed this section while you were editing."));
  assert.equal(mounted.filter((held) => !held.destroyed).length, 1, "the editor stays open");
  act(() => buttonText(container, "Keep mine").click());
  finish();
  await settle();

  assert.deepEqual(
    sent.map(({ base }) => base),
    [PROBLEM, lukes],
  );
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("Use Luke's closes the editor on his words and saves nothing more", async () => {
  const lukes = "- Only an admin or an owner can add a member.";
  const { container, sent } = mount(PLAN, [{ conflict: { current: lukes } }]);
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));
  finish();
  await settle();

  act(() => buttonText(container, "Use Luke's").click());
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("a save that failed says why and keeps the words; Try again saves them", async () => {
  const { container, sent } = mount(PLAN, [
    { failure: PLAN_CALL_FAILURE.UNANSWERED },
    { saved: true },
  ]);
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));
  finish();
  await settle();

  assert.ok(container.textContent?.includes("Not saved: the service did not answer."));
  assert.equal(mounted.filter((held) => !held.destroyed).length, 1, "the editor stays open");
  act(() => buttonText(container, "Try again").click());
  await settle();

  assert.equal(sent.length, 2);
  assert.equal(sent[1]?.value, "- Only an owner can add a member.");
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("a save the service refused because the plan is archived says so and keeps the words", async () => {
  const { container } = mount(PLAN, [{ failure: PLAN_CALL_FAILURE.PLAN_ARCHIVED }]);
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));
  finish();
  await settle();

  assert.ok(container.textContent?.includes("Not saved: this plan is archived."));
  assert.equal(mounted.filter((held) => !held.destroyed).length, 1, "the editor stays open");
});

test("words typed and not yet saved are sent when the developer leaves the plan", async () => {
  const { container, sent, root } = mount(PLAN);
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));

  act(() => root.unmount());
  await settle();

  assert.deepEqual(sent, [
    { field: PLAN_FIELD.PROBLEM, base: PROBLEM, value: "- Only an owner can add a member." },
  ]);
});

test("words typed in one plan are saved to that plan when another opens", async () => {
  const { container, sent, root } = mount(PLAN);
  const doors: string[] = [];
  const door = (planId: string) => (request: PlanEditRequest) => {
    doors.push(planId);
    sent.push(request);
    return Promise.resolve<PlanningEditAnswer>({ saved: true });
  };
  act(() =>
    root.render(createElement(PlanBody, { plan: PLAN, live: false, onEdit: door(PLAN.id) })),
  );
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));

  const other = { ...PLAN, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  act(() =>
    root.render(createElement(PlanBody, { plan: other, live: false, onEdit: door(other.id) })),
  );
  await settle();

  assert.deepEqual(doors, [PLAN.id]);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("Esc and the editor losing focus at once save the words once", async () => {
  const { container, sent } = mount(PLAN);
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));

  act(() => {
    open().onFinish();
    container
      .querySelector(".plan-field-editor")
      ?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  });
  await settle();

  assert.equal(sent.length, 1);
});

const RULE = { statement: "Any member may invite by email.", examples: null };

const LISTED_FIELDS: PlanFields = {
  ...FIELDS,
  rules: [RULE],
  openQuestions: ["Who can withdraw an invite?"],
};

/** A plan with a rule, a question, and an assumption, each a field the developer can edit. */
const LISTED: Plan = {
  ...PLAN,
  document: {
    body: planBody({ name: "Teammate invitations" }, LISTED_FIELDS),
    assumptions: [{ text: "Invites reuse memberships." }],
  },
  fields: LISTED_FIELDS,
};

test("a rule opens as its statement and examples, its number kept, and saves as the rules with it changed", async () => {
  const { container, sent } = mount(LISTED);
  edit(container, "Rule 1");

  assert.deepEqual(open().value, {
    kind: FIELD_KIND.RULE,
    rule: { statement: RULE.statement, examples: [] },
  });
  assert.equal(container.querySelector(".plan-field-editor .plan-rule-number")?.textContent, "1.");
  type({
    kind: FIELD_KIND.RULE,
    rule: {
      statement: "Any member may invite by email or link.",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
      examples: [{ given: "A member", when: "", then: "" }], // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
    },
  });
  finish();
  await settle();

  assert.deepEqual(sent, [
    {
      field: PLAN_FIELD.RULES,
      base: [RULE],
      value: [
        {
          statement: "Any member may invite by email or link.",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
          examples: [{ given: "A member", when: null, then: null }], // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
        },
      ],
    },
  ]);
});

test("Return on the rules' heading adds a rule after the rules standing; Delete rule strikes one", async () => {
  const added = mount(LISTED);
  edit(added.container, "Rules");
  assert.equal(open().label, "New rule");
  type({
    kind: FIELD_KIND.RULE,
    rule: { statement: "Invites expire after 7 days.", examples: [] },
  });
  finish();
  await settle();
  const addedSent = [...added.sent];

  const struck = mount(LISTED);
  edit(struck.container, "Rule 1");
  act(() => buttonText(struck.container, "Delete rule").click());
  await settle();

  assert.deepEqual(addedSent[0]?.value, [
    RULE,
    { statement: "Invites expire after 7 days.", examples: null },
  ]);
  assert.deepEqual(struck.sent[0]?.value, null);
  assert.equal(struck.container.querySelector(".plan-field-editor"), null);
});

test("the open questions open as Markdown items and the assumptions as plain ones, and save a line as an item", async () => {
  const { container, sent } = mount(LISTED);
  edit(container, "Open questions");
  assert.deepEqual(open().value, {
    kind: FIELD_KIND.QUESTIONS,
    text: "Who can withdraw an invite?",
  });
  type({
    kind: FIELD_KIND.QUESTIONS,
    text: "- Who can withdraw an invite?\n- How long is a link valid?",
  });
  finish();
  await settle();

  edit(container, "Assumptions");
  assert.deepEqual(open().value, {
    kind: FIELD_KIND.ASSUMPTIONS,
    text: "Invites reuse memberships.",
  });
  type({ kind: FIELD_KIND.ASSUMPTIONS, text: "" });
  finish();
  await settle();

  assert.deepEqual(
    sent.map(({ field, value }) => ({ field, value })),
    [
      {
        field: PLAN_FIELD.OPEN_QUESTIONS,
        value: ["Who can withdraw an invite?", "How long is a link valid?"],
      },
      { field: PLAN_FIELD.ASSUMPTIONS, value: [] },
    ],
  );
});

test("a section the body leaves out while empty is offered to add, and opens its editor after the body", async () => {
  const { container, sent } = mount(PLAN);

  act(() => buttonText(container, "Data and migration").click());
  assert.ok(container.querySelector('[aria-label="Editing Data and migration"]'));
  type(text("No stored data changes."));
  finish();
  await settle();

  assert.deepEqual(sent, [
    { field: PLAN_FIELD.DATA_AND_MIGRATION, base: null, value: "No stored data changes." },
  ]);
});

test("a rule only a notetaker's draft holds so far is drawn but not yet offered to edit", () => {
  const drafted: PlanFields = {
    ...LISTED_FIELDS,
    rules: [RULE, { statement: "Invites expire after 7 days.", examples: null }],
  };
  const { container } = mount({
    ...LISTED,
    document: { ...LISTED.document, body: planBody({ name: "Teammate invitations" }, drafted) },
  });

  assert.ok(container.textContent?.includes("Invites expire after 7 days."));
  assert.ok(block(container, "Rule 1"));
  assert.equal(container.querySelector('[role="group"][aria-label="Rule 2"]'), null);
});

test("the document is one Tab stop, at the block selected last, and the arrows move between blocks", () => {
  const { container } = mount(LISTED);
  const stops = () =>
    [...container.querySelectorAll<HTMLElement>('[role="group"]')]
      .filter((found) => found.tabIndex === 0)
      .map((found) => found.getAttribute("aria-label"));

  assert.deepEqual(stops(), ["Problem"]);
  act(() => block(container, "Problem").focus());
  pressOn(block(container, "Problem"), "ArrowDown");
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Outcome");
  pressOn(block(container, "Outcome"), "ArrowUp");
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Problem");
  pressOn(block(container, "Problem"), "ArrowDown");

  assert.deepEqual(stops(), ["Outcome"]);
});

test("Esc in the editor saves and selects its block again, so the keyboard carries on from it", async () => {
  const { container, sent } = mount(PLAN);
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));

  finish();
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(container.querySelector(".plan-field-editor"), null);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Problem");
});

test("a save under way says nothing under the editor", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const waiting = () => new Promise<PlanningEditAnswer>(() => undefined);
  act(() => root.render(createElement(PlanBody, { plan: PLAN, live: false, onEdit: waiting })));
  edit(container, "Problem");
  type(text("- Only an owner can add a member."));

  finish();
  await settle();

  assert.ok(container.querySelector(".plan-field-editor"), "the editor waits for its save");
  assert.equal(container.querySelector(".plan-field-note"), null);
});
