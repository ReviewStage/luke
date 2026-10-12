// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { PLAN_ACTOR, PLAN_BOUNDS, type Plan } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, type PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DOCUMENT_NAME, DOCUMENT_PLAN } from "#testing/document-plan";
import { installScrollIntoView } from "#testing/scroll-into-view";
import type { PlanEditorModule, PlanEditorProps } from "../plan-editor/contract";
import { PlanBody } from "./plan-body";

/**
 * The editor itself is TipTap in a bundle of its own (`../plan-editor/`),
 * tested beside it. Here the document mounts a stand-in for that bundle at
 * its one boundary, `window.lukePlanEditor`, and the tests speak as the
 * editor would: the text it hands over, its finish, and its leaving up.
 */

const BODY = DOCUMENT_PLAN.document.body;

/** Every editor the document mounted, newest last, with what it was handed and what it was asked to take. */
const mounted: { props: PlanEditorProps; destroyed: boolean; took: [string, string][] }[] = [];

/** The stand-in for the editor's bundle: it records what it is handed and takes a merged answer whole. */
const STAND_IN: PlanEditorModule = {
  mount: (_host, props) => {
    const took: [string, string][] = [];
    const editor = { props, destroyed: false, took };
    mounted.push(editor);
    return {
      take: (sent, merged) => {
        editor.took.push([sent, merged]);
        return { base: merged, text: merged };
      },
      destroy: () => {
        editor.destroyed = true;
      },
    };
  },
};

// Set before any document renders, since the document reads the bundle once per window.
window.lukePlanEditor = STAND_IN;

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  // A document arriving is drawn at once under reduced motion, which jsdom has no answer to.
  const ignore = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: ignore, removeEventListener: ignore }),
  });
});

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

/**
 * The document with an edit door that records each edit and answers from the
 * script, and the names it renamed to; `render` draws another plan, through
 * its own door where given.
 */
function mount(answers: readonly PlanningEditAnswer[] = []) {
  const sent: PlanEditRequest[] = [];
  const renamed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const saved: PlanningEditAnswer = { saved: true };
  const onEdit = (request: PlanEditRequest) => {
    sent.push(request);
    return Promise.resolve(answers[sent.length - 1] ?? saved);
  };
  const onRename = (name: string) => renamed.push(name);
  const render = (plan: Plan, door: typeof onEdit = onEdit) =>
    act(() => root.render(createElement(PlanBody, { plan, live: false, onEdit: door, onRename })));
  render(DOCUMENT_PLAN);
  const unmount = () => {
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
  };
  return { container, sent, renamed, render, unmount };
}

function block(container: HTMLElement, label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
  assert.ok(found, `the ${label} block`);
  return found;
}

function press(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** The editor open now, as the document handed it over. */
function open(): PlanEditorProps {
  const editor = mounted.filter((held) => !held.destroyed).at(-1);
  assert.ok(editor, "an open editor");
  return editor.props;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  assert.ok(found, text);
  return found;
}

function title(container: HTMLElement): HTMLElement {
  const text = container.querySelector<HTMLElement>('[aria-label="Plan name"]');
  assert.ok(text, "the title's words");
  return text;
}

test("a click into a section opens the whole text in place, the caret where the click landed, under a block the recording does not capture", () => {
  const { container } = mount();
  const goal = block(container, "Goal");

  act(() => {
    goal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 48 }));
  });

  assert.equal(open().markdown, BODY);
  assert.deepEqual(open().placement, { x: 120, y: 48 });
  assert.ok(container.querySelector(".plan-document-editor")?.classList.contains("ph-no-capture"));
  assert.equal(title(container).textContent, DOCUMENT_NAME, "the title stays over the text");
});

test("the document is one Tab stop, at its title; the arrows move between blocks, and Return on a section opens the text at its end", () => {
  const { container } = mount();
  const stops = () =>
    [...container.querySelectorAll<HTMLElement>('[role="group"]')]
      .filter((found) => found.tabIndex === 0)
      .map((found) => found.getAttribute("aria-label"));

  assert.deepEqual(stops(), ["Title"]);
  act(() => block(container, "Title").focus());
  press(block(container, "Title"), "ArrowDown");
  const context = document.activeElement;
  assert.ok(context !== null);
  press(context, "ArrowDown");
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Goal");
  assert.deepEqual(stops(), ["Goal"]);
  press(block(container, "Goal"), "Enter");

  assert.deepEqual(open().placement, { section: 1 });
});

test("the Tab stop on a section that goes, with Luke's change or with another plan opened, falls back to the title", () => {
  const { container, render } = mount();
  const stops = () =>
    [...container.querySelectorAll<HTMLElement>('[role="group"]')]
      .filter((found) => found.tabIndex === 0)
      .map((found) => found.getAttribute("aria-label"));
  act(() => block(container, "Goal").focus());
  press(block(container, "Goal"), "ArrowDown");
  assert.deepEqual(stops(), ["Approach"]);

  const withoutApproach = BODY.slice(0, BODY.indexOf("## Approach"));
  render({ ...DOCUMENT_PLAN, document: { ...DOCUMENT_PLAN.document, body: withoutApproach } });
  assert.deepEqual(stops(), ["Title"]);

  act(() => block(container, "Goal").focus());
  render({ ...DOCUMENT_PLAN, id: "0b9c7d4e-1f2a-4b3c-8d5e-6f7a8b9c0d1e" });
  assert.deepEqual(stops(), ["Title"]);
});

test("the text saves as the document's base and value, and Esc selects the section the caret stood in", async () => {
  const { container, sent } = mount();
  act(() => block(container, "Goal").click());

  act(() =>
    open().onDraft(BODY.replace("Invites land by email.", "Invites land by email or link.")),
  );
  act(() => open().onFinish(2));
  await settle();

  assert.deepEqual(sent, [
    {
      document: {
        base: BODY,
        value: BODY.replace("Invites land by email.", "Invites land by email or link."),
      },
    },
  ]);
  assert.equal(container.querySelector(".plan-document-editor"), null);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Approach");
});

test("a save's merged answer is taken into the open editor and becomes the next save's base; a draft is not", async () => {
  const { container, sent, render } = mount();
  act(() => block(container, "Goal").click());
  const mine = BODY.replace("Invites land by email.", "Invites land by email. Mine.");
  act(() => open().onDraft(mine));
  act(() => open().onFinish(1));
  // Note that finishing waits for the save, so the editor still stands while it is out.
  const merged = mine.replace("Links are single use.", "Links are single use, by Luke.");
  render({
    ...DOCUMENT_PLAN,
    updatedAt: DOCUMENT_PLAN.updatedAt + 1,
    document: { ...DOCUMENT_PLAN.document, body: merged },
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 5, duringCall: false },
  });
  await settle();

  assert.deepEqual(mounted[0]?.took, [[mine, merged]]);

  const again = mount();
  act(() => block(again.container, "Goal").click());
  again.render({
    ...DOCUMENT_PLAN,
    document: { ...DOCUMENT_PLAN.document, body: `${BODY}A notetaker's draft.\n` },
  });
  assert.equal(
    mounted.filter((held) => !held.destroyed).length,
    1,
    "the open editor is not built again",
  );
  assert.deepEqual(mounted.at(-1)?.took, []);
  assert.equal(sent.length, 1);
});

test("Luke's change where the developer's words land asks Keep mine or Use Luke's", async () => {
  const lukes = BODY.replace("Invites land by email.", "Invites land by link.");
  const { container, sent } = mount([{ conflict: { current: lukes } }]);
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(BODY.replace("Invites land by email.", "Invites land by text.")));
  act(() => open().onFinish(1));
  await settle();

  assert.ok(container.textContent?.includes("Luke changed this section while you were editing."));
  act(() => button(container, "Keep mine").click());
  act(() => open().onFinish(1));
  await settle();

  assert.deepEqual(
    sent.map((request) => ("document" in request ? request.document.base : undefined)),
    [BODY, lukes],
  );
});

test("Use Luke's closes the editor on his words and saves nothing more", async () => {
  const lukes = BODY.replace("Invites land by email.", "Invites land by link.");
  const { container, sent } = mount([{ conflict: { current: lukes } }]);
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(BODY.replace("Invites land by email.", "Invites land by text.")));
  act(() => open().onFinish(1));
  await settle();

  act(() => button(container, "Use Luke's").click());
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(container.querySelector(".plan-document-editor"), null);
});

test("an editor closed with nothing changed saves nothing", async () => {
  const { container, sent } = mount();
  act(() => block(container, "Goal").click());

  act(() => open().onFinish(1));
  await settle();

  assert.deepEqual(sent, []);
  assert.equal(container.querySelector(".plan-document-editor"), null);
});

test("a save that failed says why and keeps the editor open; Retry saves the words", async () => {
  const { container, sent } = mount([{ failure: PLAN_CALL_FAILURE.UNANSWERED }]);
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));
  act(() => open().onFinish(1));
  await settle();

  assert.ok(container.textContent?.includes("Not saved: the service did not answer."));
  assert.ok(container.querySelector(".plan-document-editor"), "the editor stays open");
  act(() => button(container, "Retry").click());
  await settle();

  assert.deepEqual(
    sent.map((request) => ("document" in request ? request.document.value : undefined)),
    [`${BODY}Mine.\n`, `${BODY}Mine.\n`],
  );
  assert.equal(container.querySelector(".plan-document-editor"), null);
});

test("words handed over and not yet saved are sent when the developer leaves the plan", async () => {
  const { container, sent, unmount } = mount();
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));

  unmount();
  await settle();

  assert.deepEqual(sent, [{ document: { base: BODY, value: `${BODY}Mine.\n` } }]);
});

test("words typed while a save is out are saved after it, from what it saved, when the developer leaves the plan", async () => {
  const { container, render, unmount } = mount();
  const sent: PlanEditRequest[] = [];
  let answer: (answered: PlanningEditAnswer) => void = () => undefined;
  const door = (request: PlanEditRequest) => {
    sent.push(request);
    if (sent.length > 1) return Promise.resolve<PlanningEditAnswer>({ saved: true });
    return new Promise<PlanningEditAnswer>((land) => {
      answer = land;
    });
  };
  render(DOCUMENT_PLAN, door);
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));
  act(() => open().onFinish(1));
  act(() => open().onDraft(`${BODY}Mine, more.\n`));

  unmount();
  answer({ saved: true });
  await settle();

  assert.deepEqual(sent, [
    { document: { base: BODY, value: `${BODY}Mine.\n` } },
    { document: { base: `${BODY}Mine.\n`, value: `${BODY}Mine, more.\n` } },
  ]);
});

test("words typed in one plan are saved to that plan when another opens", async () => {
  const { container, render } = mount();
  const doors: string[] = [];
  const door = (planId: string) => () => {
    doors.push(planId);
    return Promise.resolve<PlanningEditAnswer>({ saved: true });
  };
  const other = { ...DOCUMENT_PLAN, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  render(DOCUMENT_PLAN, door(DOCUMENT_PLAN.id));
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));

  render(other, door(other.id));
  await settle();

  assert.deepEqual(doors, [DOCUMENT_PLAN.id]);
  assert.equal(container.querySelector(".plan-document-editor"), null);
});

test("the title renames the plan on Return and goes into the text at its start; left empty, it renames nothing", () => {
  const { container, renamed } = mount();
  const text = title(container);

  act(() => {
    text.focus();
    text.textContent = "Teammate invites";
  });
  press(text, "Enter");
  assert.deepEqual(renamed, ["Teammate invites"]);
  assert.equal(open().placement, undefined, "the text opens at its start");

  const again = mount();
  const emptied = title(again.container);
  act(() => {
    emptied.focus();
    emptied.textContent = "  ";
  });
  press(emptied, "Escape");

  assert.deepEqual(again.renamed, []);
  assert.equal(emptied.textContent, DOCUMENT_NAME);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Title");
});

test("the title renamed by Esc renames once, not again as the focus leaves it; a name past the bound is cut to it", () => {
  const { container, renamed } = mount();
  const text = title(container);

  act(() => {
    text.focus();
    text.textContent = "Teammate invites";
  });
  press(text, "Escape");
  act(() => text.dispatchEvent(new FocusEvent("blur")));
  assert.deepEqual(renamed, ["Teammate invites"]);

  const long = "Invites ".repeat(40);
  act(() => {
    text.focus();
    text.textContent = long;
  });
  press(text, "Escape");
  assert.deepEqual(renamed, ["Teammate invites", long.slice(0, PLAN_BOUNDS.MAX_NAME_CHARS).trim()]);
  assert.equal(text.textContent, long.slice(0, PLAN_BOUNDS.MAX_NAME_CHARS).trim());
});

test("a rename refused, which puts the plan's old name back, puts the title's words back too", () => {
  const { container, render } = mount();
  const text = title(container);
  act(() => {
    text.focus();
    text.textContent = "Teammate invites";
  });
  press(text, "Escape");

  render({ ...DOCUMENT_PLAN, name: "Teammate invites" });
  render(DOCUMENT_PLAN);

  assert.equal(text.textContent, DOCUMENT_NAME);
});

test("↑ on the text's first line saves it and goes into the title", async () => {
  const { container, sent } = mount();
  act(() => block(container, "Context").click());
  act(() => open().onDraft(`${BODY}More.\n`));

  act(() => open().onLeaveUp());
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(container.querySelector(".plan-document-editor"), null);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Plan name");
});
