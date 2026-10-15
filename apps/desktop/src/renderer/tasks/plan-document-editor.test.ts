// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import type { TasksEditAnswer } from "@luke/features/tasks-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DOCUMENT_NAME, DOCUMENT_TASK } from "#testing/document-task";
import { fadedEdges, layFades } from "#testing/scroll-fade";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { DIAGRAM_DRAWING } from "../diagram/contract";
import type { PlanEditorModule, PlanEditorProps } from "../plan-editor/contract";
import { PlanBody } from "./plan-body";

/**
 * The editor itself is TipTap in a bundle of its own (`../plan-editor/`),
 * tested beside it. Here the document mounts a stand-in for that bundle at
 * its one boundary, `window.lukePlanEditor`, and the tests speak as the
 * editor would: the text it hands over, its finish, and its leaving up.
 */

const BODY = DOCUMENT_TASK.document.body;

const CHARLES = { userId: "user-charles", name: "Charles Pan" };

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
      chooseMention: () => undefined,
      markdown: () => props.markdown,
      insertPictures: () => undefined,
      settlePicture: () => undefined,
      removePicture: () => undefined,
      destroy: () => {
        editor.destroyed = true;
      },
    };
  },
  mountComposer: () => assert.fail("the plan document mounts no message box"),
};

// Set before any document renders, since the document reads the bundle once per window.
window.lukePlanEditor = STAND_IN;

/** The diagram bundle's stand-in: a picture named by the code and the appearance it was asked to draw. */
const diagramPicture = (code: string, appearance: string) =>
  `data:image/svg+xml,${encodeURIComponent(`${appearance}:${code}`)}`;
window.lukeDiagram = {
  draw: (code, appearance) =>
    Promise.resolve({ kind: DIAGRAM_DRAWING.DRAWN, url: diagramPicture(code, appearance) }),
};

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
function mount(answers: readonly TasksEditAnswer[] = []) {
  const sent: PlanEditRequest[] = [];
  const renamed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const saved: TasksEditAnswer = { saved: true };
  const onEdit = (request: PlanEditRequest) => {
    sent.push(request);
    return Promise.resolve(answers[sent.length - 1] ?? saved);
  };
  const onRename = (name: string) => {
    renamed.push(name);
    return Promise.resolve(true);
  };
  const render = (task: Task, door: typeof onEdit = onEdit) =>
    act(() => root.render(createElement(PlanBody, { task, live: false, onEdit: door, onRename })));
  render(DOCUMENT_TASK);
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

function _press(element: Element, key: string): void {
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

function _button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  assert.ok(found, text);
  return found;
}

function title(container: HTMLElement): HTMLElement {
  const text = container.querySelector<HTMLElement>('[aria-label="Task name"]');
  assert.ok(text, "the title's words");
  return text;
}

test("the document fades under the toolbar or a banner over it and over the call bar under it, rather than being sliced at either", () => {
  const { container } = mount();
  const sheets = layFades();
  try {
    const scroller =
      container.querySelector(".plan-document-scroll") ?? assert.fail("the document scrolls");
    assert.deepEqual(fadedEdges(scroller), { top: true, bottom: true });
  } finally {
    sheets.remove();
  }
});

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

test("the editor's preview of a Mermaid block is the picture the diagram bundle answered, drawn by the panel until the editor takes it down", async () => {
  const { container } = mount();
  act(() => block(container, "Goal").click());
  const draw = open().drawDiagram;
  assert.ok(draw, "the document hands the editor its diagrams");
  // The element the editor stands under the block, inside its own host.
  const under = document.createElement("div");
  container.querySelector(".plan-document-editor")?.append(under);
  const code = "flowchart LR\n  Invite --> Join";

  let takeDown: () => void = () => undefined;
  act(() => {
    takeDown = draw(under, { code, previous: undefined });
  });
  await settle();

  // The window stands in its dark appearance, as `matchMedia` answers here.
  assert.equal(under.querySelector("img")?.getAttribute("src"), diagramPicture(code, "dark"));
  act(() => takeDown());
  assert.equal(under.querySelector("img"), null);
});

test("a press on a diagram's Show code shows its code and opens no editor", async () => {
  const { container, render } = mount();
  const code = "flowchart LR\n  Invite --> Join";
  render({
    ...DOCUMENT_TASK,
    document: { body: `## Flow\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`, assumptions: [] },
  });
  await settle();
  const toggle = container.querySelector<HTMLButtonElement>(".plan-diagram-head button");
  assert.ok(toggle, "the diagram has its Show code");

  act(() => toggle.click());

  assert.equal(container.querySelector(".plan-diagram pre")?.textContent, `${code}\n`);
  // Note that the check is a boolean, because a failing comparison would print the whole editor's DOM.
  assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");
});

test("a press on the name in a section's byline opens no editor, while a press on the section's words still does", () => {
  const { container, render } = mount();
  const edit = { actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at: Date.now(), duringCall: false };
  render({ ...DOCUMENT_TASK, sectionEdits: [{ section: "Goal", ...edit }] });
  const goal = block(container, "Goal");
  const name = goal.querySelector(".plan-unit-byline .actor-ref");
  assert.ok(name, "the byline names who last changed the section");

  act(() => {
    name.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Note that the check is a boolean, because a failing comparison would print the whole editor's DOM.
  assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");

  act(() => goal.click());
  assert.equal(open().markdown, BODY);
});

test("a click on the panel's empty room opens an empty plan's text with the caret at its start, and opens nothing on a plan with text", () => {
  const { container, render } = mount();
  const scroller =
    container.querySelector<HTMLElement>(".plan-document-scroll") ??
    assert.fail("the document scrolls");

  act(() => scroller.click());
  // Note that the check is a boolean, because a failing comparison would print the whole editor's DOM.
  assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");

  render({ ...DOCUMENT_TASK, document: { body: "", assumptions: [] } });
  act(() => scroller.click());

  assert.equal(open().markdown, "");
  assert.equal(open().placement, undefined, "the caret at the text's start");
  assert.equal(title(container).textContent, DOCUMENT_NAME, "the title stays over the text");
});

test("words handed over and not yet saved are sent when the developer leaves the plan", async () => {
  const { container, sent, unmount } = mount();
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));

  unmount();
  await settle();

  assert.deepEqual(sent, [{ document: { base: BODY, value: `${BODY}Mine.\n` } }]);
});

test("words typed in one plan are saved to that plan when another opens", async () => {
  const { container, render } = mount();
  const doors: string[] = [];
  const door = (taskId: string) => () => {
    doors.push(taskId);
    return Promise.resolve<TasksEditAnswer>({ saved: true });
  };
  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  render(DOCUMENT_TASK, door(DOCUMENT_TASK.id));
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));

  render(other, door(other.id));
  await settle();

  assert.deepEqual(doors, [DOCUMENT_TASK.id]);
  assert.equal(container.querySelector(".plan-document-editor"), null);
});
