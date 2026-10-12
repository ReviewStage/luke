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
import { PlanBody } from "./plan-body";

const PROBLEM = "- Only an admin can add a member.";

const FIELDS: PlanFields = { ...EMPTY_PLAN_FIELDS, goal: { problem: PROBLEM, outcome: null } };

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: planBody({ name: "Teammate invitations" }, FIELDS), assumptions: [] },
  fields: FIELDS,
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
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

function pencil(container: HTMLElement, heading: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="Edit ${heading}"]`);
  assert.ok(button, `the ${heading} pencil`);
  return button;
}

function box(container: HTMLElement): HTMLTextAreaElement {
  const area = container.querySelector<HTMLTextAreaElement>("textarea.plan-field-input");
  assert.ok(area, "the editor's box");
  return area;
}

/** Types into the box the way React hears a keystroke: the value set, then the input event. */
function typeInto(area: HTMLTextAreaElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(area: HTMLTextAreaElement, key: string): void {
  act(() => {
    area.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function buttonText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  assert.ok(button, text);
  return button;
}

test("a document with no edit door, or from a service that sends no fields, offers no editor", () => {
  const { fields: _fields, ...unfielded } = PLAN;
  const { container } = mount(unfielded);

  assert.equal(container.querySelector(".plan-unit-edit"), null);
});

test("a field's pencil opens its Markdown in an editor the recording does not capture, its heading kept", () => {
  const { container } = mount(PLAN);

  act(() => pencil(container, "Problem").click());

  const editor = container.querySelector(".plan-field-editor");
  assert.ok(editor?.classList.contains("ph-no-capture"));
  assert.equal(box(container).value, PROBLEM);
  assert.ok(editor?.textContent?.includes("Problem"));
  assert.ok(container.querySelector('[aria-label="Edit Outcome"]'), "the other fields keep theirs");
});

test("Esc saves the words from what the editor opened on, and closes once the save lands", async () => {
  const { container, sent } = mount(PLAN);
  act(() => pencil(container, "Problem").click());

  typeInto(box(container), "- Only an owner can add a member.\n");
  press(box(container), "Escape");
  await settle();

  assert.deepEqual(sent, [
    { field: PLAN_FIELD.PROBLEM, base: PROBLEM, value: "- Only an owner can add a member." },
  ]);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("an editor closed with nothing changed saves nothing", async () => {
  const { container, sent } = mount(PLAN);
  act(() => pencil(container, "Outcome").click());

  press(box(container), "Escape");
  await settle();

  assert.deepEqual(sent, []);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("a conflict keeps the editor open on the developer's words; Keep mine saves them over Luke's", async () => {
  const lukes = "- Only an admin or an owner can add a member.";
  const { container, sent } = mount(PLAN, [{ conflict: { current: lukes } }, { saved: true }]);
  act(() => pencil(container, "Problem").click());
  typeInto(box(container), "- Only an owner can add a member.");
  press(box(container), "Escape");
  await settle();

  assert.ok(container.textContent?.includes("Luke changed this section while you were editing."));
  assert.equal(box(container).value, "- Only an owner can add a member.");
  act(() => buttonText(container, "Keep mine").click());
  press(box(container), "Escape");
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
  act(() => pencil(container, "Problem").click());
  typeInto(box(container), "- Only an owner can add a member.");
  press(box(container), "Escape");
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
  act(() => pencil(container, "Problem").click());
  typeInto(box(container), "- Only an owner can add a member.");
  press(box(container), "Escape");
  await settle();

  assert.ok(container.textContent?.includes("Not saved: the service did not answer."));
  assert.equal(box(container).value, "- Only an owner can add a member.");
  act(() => buttonText(container, "Try again").click());
  await settle();

  assert.equal(sent.length, 2);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("a save the service refused because the plan is archived says so and keeps the words", async () => {
  const { container } = mount(PLAN, [{ failure: PLAN_CALL_FAILURE.PLAN_ARCHIVED }]);
  act(() => pencil(container, "Problem").click());
  typeInto(box(container), "- Only an owner can add a member.");
  press(box(container), "Escape");
  await settle();

  assert.ok(container.textContent?.includes("Not saved: this plan is archived."));
  assert.equal(box(container).value, "- Only an owner can add a member.");
});

test("words typed and not yet saved are sent when the developer leaves the plan", async () => {
  const { container, sent, root } = mount(PLAN);
  act(() => pencil(container, "Problem").click());
  typeInto(box(container), "- Only an owner can add a member.");

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
  act(() => pencil(container, "Problem").click());
  typeInto(box(container), "- Only an owner can add a member.");

  const other = { ...PLAN, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  act(() =>
    root.render(createElement(PlanBody, { plan: other, live: false, onEdit: door(other.id) })),
  );
  await settle();

  assert.deepEqual(doors, [PLAN.id]);
  assert.equal(container.querySelector(".plan-field-editor"), null);
});

test("Esc and the box losing focus at once save the words once", async () => {
  const { container, sent } = mount(PLAN);
  act(() => pencil(container, "Problem").click());
  typeInto(box(container), "- Only an owner can add a member.");

  act(() => {
    box(container).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    box(container).dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
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

function input(container: HTMLElement, label: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  assert.ok(found, label);
  return found;
}

/** Types into an input the way React hears a keystroke. */
function typeIntoInput(field: HTMLInputElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressOn(element: HTMLElement, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

test("a rule opens as its statement and examples, and saves as the rules with it changed", async () => {
  const { container, sent } = mount(LISTED);
  act(() => pencil(container, "Rule 1").click());

  const statement = input(container, "Rule 1 statement");
  assert.equal(statement.value, RULE.statement);
  typeIntoInput(statement, "Any member may invite by email or link.");
  act(() => buttonText(container, "Add example").click());
  typeIntoInput(input(container, "Example 1 Given"), "A member");
  pressOn(statement, "Escape");
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

test("the rules' plus adds a rule after the rules standing; Delete rule strikes one", async () => {
  const added = mount(LISTED);
  act(() => {
    const plus = added.container.querySelector<HTMLButtonElement>('[aria-label="Add rule"]');
    assert.ok(plus, "the rules' plus");
    plus.click();
  });
  typeIntoInput(input(added.container, "New rule statement"), "Invites expire after 7 days.");
  pressOn(input(added.container, "New rule statement"), "Escape");
  await settle();

  const struck = mount(LISTED);
  act(() => pencil(struck.container, "Rule 1").click());
  act(() => buttonText(struck.container, "Delete rule").click());
  await settle();

  assert.deepEqual(added.sent[0]?.value, [
    RULE,
    { statement: "Invites expire after 7 days.", examples: null },
  ]);
  assert.deepEqual(struck.sent[0]?.value, null);
  assert.equal(struck.container.querySelector(".plan-field-editor"), null);
});

test("the open questions and the assumptions open one to a line, and save a line as an item", async () => {
  const { container, sent } = mount(LISTED);
  act(() => pencil(container, "Open questions").click());
  assert.equal(box(container).value, "Who can withdraw an invite?");
  typeInto(box(container), "Who can withdraw an invite?\nHow long is a link valid?");
  press(box(container), "Escape");
  await settle();

  act(() => pencil(container, "Assumptions").click());
  assert.equal(box(container).value, "Invites reuse memberships.");
  typeInto(box(container), "");
  press(box(container), "Escape");
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
  typeInto(box(container), "No stored data changes.");
  press(box(container), "Escape");
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
  assert.ok(container.querySelector('[aria-label="Edit Rule 1"]'));
  assert.equal(container.querySelector('[aria-label="Edit Rule 2"]'), null);
});
