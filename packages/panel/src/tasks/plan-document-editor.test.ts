// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TasksEditAnswer } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { DIAGRAM_DRAWING, type DiagramModule } from "@luke/ui/diagram-contract";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { type SideBundles, sideBundles } from "../bundle-loader.js";
import {
  FINISH,
  PLACEMENT_END,
  type PlacedWords,
  type PlanEditorModule,
  type PlanEditorPlacement,
  type PlanEditorProps,
} from "../plan-editor/contract.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_NAME, DOCUMENT_TASK } from "../testing/document-task.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { PlanBody } from "./plan-body.js";
import { usePlanEditDoor, usePlanWordsUnsaved } from "./use-plan-editing.js";

/**
 * The editor itself is TipTap in a bundle of its own (`../plan-editor/`),
 * tested beside it. Here the document mounts a stand-in for that bundle at
 * its one boundary, the bundle's importer, and the tests speak as the
 * editor would: the text it hands over, its finish, and its leaving up.
 */

const BODY = DOCUMENT_TASK.document.body;

const CHARLES = { userId: "user-charles", name: "Charles Pan" };

/** Every editor the document mounted, newest last, with what it was handed, what it was asked to take, and where a press on its room put its caret. */
const mounted: {
  props: PlanEditorProps;
  destroyed: boolean;
  took: [string, string][];
  placed: PlanEditorPlacement[];
}[] = [];

/** Where the line of the words the stand-in opened on stands in the window, as a laid-out editor answers; none, as when the words were not found, unless a test lays it out. */
let wordsLine: (() => number) | undefined;

/** The words the stand-in's caret stands in as it closes, as a laid-out editor answers; none unless a test lays them out. */
let caretOn: PlacedWords | undefined;

/** The stand-in for the editor's bundle: it records what it is handed and takes a merged answer whole. */
const STAND_IN: PlanEditorModule = {
  mount: (_host, props) => {
    const took: [string, string][] = [];
    const placed: PlanEditorPlacement[] = [];
    const editor = { props, destroyed: false, took, placed };
    mounted.push(editor);
    return {
      take: (sent, merged) => {
        editor.took.push([sent, merged]);
        return { base: merged, text: merged };
      },
      chooseMention: () => undefined,
      insertBlock: () => undefined,
      markdown: () => props.markdown,
      setAria: () => undefined,
      focusAt: (placement) => {
        placed.push(placement);
      },
      wordsTop: () => wordsLine?.(),
      caretWords: () => caretOn,
      insertPictures: () => undefined,
      settlePicture: () => undefined,
      removePicture: () => undefined,
      selectionSpan: () => undefined,
      blockSpan: () => undefined,
      selectionBox: () => undefined,
      toggleMark: () => undefined,
      turnInto: () => undefined,
      setLink: () => undefined,
      focus: () => undefined,
      destroy: () => {
        editor.destroyed = true;
      },
    };
  },
  mountComposer: () => assert.fail("the plan document mounts no message box"),
};

/** The diagram bundle's stand-in: a picture named by the code and the appearance it was asked to draw. */
const diagramPicture = (code: string, appearance: string) =>
  `data:image/svg+xml,${encodeURIComponent(`${appearance}:${code}`)}`;
const DIAGRAM_STAND_IN: DiagramModule = {
  draw: (code, appearance) =>
    Promise.resolve({ kind: DIAGRAM_DRAWING.DRAWN, url: diagramPicture(code, appearance) }),
};

let bundles: SideBundles;

// Landed before any document renders, as both are once a plan has been shown in this window.
beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({
      planEditor: () => Promise.resolve(STAND_IN),
      diagram: () => Promise.resolve(DIAGRAM_STAND_IN),
    }),
  );
});

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

beforeEach(() => {
  installScrollIntoView();
  // A document arriving is drawn at once where motion is held still.
  holdMotion();
  const ignore = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: ignore, removeEventListener: ignore }),
  });
});

afterEach(async () => {
  releaseMotion();
  wordsLine = undefined;
  caretOn = undefined;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  // Note that the saves a plan left as it went answer before its atoms go.
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  for (const registry of registries.splice(0)) registry.dispose();
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
 * script, and the names it renamed to, beside the window's toasts and over
 * atoms of its own, as the window holds them; `render` draws another plan,
 * through its own door where given.
 */
/** What the window tells its shell of the plans' words, drawn beside the plan as a shell would read it. */
function UnsavedWords(): ReactElement {
  return createElement("output", { "data-unsaved-words": String(usePlanWordsUnsaved()) });
}

/** Whether the window says a plan holds words not saved. */
function unsavedWords(container: HTMLElement): boolean {
  return (
    container.querySelector("[data-unsaved-words]")?.getAttribute("data-unsaved-words") === "true"
  );
}

function mount(answers: readonly TasksEditAnswer[] = [], first: Task = DOCUMENT_TASK) {
  const sent: PlanEditRequest[] = [];
  const renamed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const saved: TasksEditAnswer = { saved: true };
  const onEdit = (request: PlanEditRequest) => {
    sent.push(request);
    return Promise.resolve(answers[sent.length - 1] ?? saved);
  };
  const onRename = (name: string) => {
    renamed.push(name);
    return Promise.resolve(true);
  };
  const draw = (page: ReactElement) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          onSideBundles(
            bundles,
            createElement(
              Fragment,
              null,
              page,
              createElement(ToastHost),
              createElement(UnsavedWords),
            ),
          ),
        ),
      ),
    );
  const render = (task: Task, door: typeof onEdit = onEdit) =>
    draw(createElement(PlanBody, { task, live: false, onEdit: door, onRename }));
  /** The plan as a task's page draws it, saving through `edit` by the task's id. */
  const renderPage = (task: Task, edit: TaskEdit) =>
    draw(createElement(TaskPage, { task, edit, onRename }));
  render(first);
  const unmount = () => {
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
  };
  return { container, sent, renamed, render, renderPage, unmount };
}

/** How a task's page saves a plan's edit: by the task's id. */
type TaskEdit = (taskId: string, request: PlanEditRequest) => Promise<TasksEditAnswer>;

/** The plan as a task's page draws it, its edits saved through `edit` with the open task's id. */
function TaskPage({
  task,
  edit,
  onRename,
}: {
  task: Task;
  edit: TaskEdit;
  onRename: (name: string) => Promise<boolean>;
}): ReactElement {
  const onEdit = usePlanEditDoor(task.id, edit);
  return createElement(PlanBody, { task, live: false, onEdit, onRename });
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

test("the open text wears every class its drawn sections wear, so a list keeps its gutter and nothing moves as it opens or closes", () => {
  const { container } = mount([], {
    ...DOCUMENT_TASK,
    document: { body: "- reproduce\n  - twice\n- fix\n", assumptions: [] },
  });
  const drawn = container.querySelector<HTMLElement>(".luke-editable-block .plan-unit");
  const worn = [...(drawn?.classList ?? [])];
  assert.ok(worn.includes("plan-unit"), "the plan's words are drawn");

  act(() => {
    drawn?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 12 }));
  });

  const wears = new Set(open().className.split(" "));
  assert.deepEqual(
    worn.filter((name) => !wears.has(name)),
    [],
  );
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

test("a mouse's press on a diagram in a wide room, which enlarges nothing, opens the editor as a press on its words does", async () => {
  const { container, render } = mount();
  render({
    ...DOCUMENT_TASK,
    document: {
      body: "## Flow\n\n```mermaid\nflowchart LR\n  Invite --> Join\n```\n",
      assumptions: [],
    },
  });
  await settle();
  // A mouse: the window answers every query but a finger's.
  const ignore = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: !query.includes("pointer: coarse"),
      addEventListener: ignore,
      removeEventListener: ignore,
    }),
  });
  const picture = container.querySelector<HTMLElement>(".plan-diagram-picture");
  assert.ok(picture, "the diagram is drawn");

  act(() => {
    picture.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });

  assert.equal(
    document.querySelector(".attachment-viewer"),
    null,
    "nothing opened over the window",
  );
  assert.ok(container.querySelector(".plan-document-editor") !== null, "the editor opened");
});

test("a press on a video in a section, on its frame, its scrubber, Play, Full screen, or Expand, opens no editor, while a press on its caption still does", async () => {
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.TASKS_PICTURE_READ]: () =>
      Promise.resolve({ contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: "GkXfow==" }),
  });
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => "blob:plan-recording";
  URL.revokeObjectURL = () => undefined;
  // The window's playing and full screen, which jsdom does not implement.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
  const fullScreen = Object.getOwnPropertyDescriptor(Element.prototype, "requestFullscreen");
  Object.defineProperty(Element.prototype, "requestFullscreen", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  try {
    const address = planAttachmentAddress(
      { taskId: DOCUMENT_TASK.id, attachmentId: "8c2d4e6f-1a3b-4c5d-9e7f-0a1b2c3d4e5f" },
      "acme",
    );
    const { container } = mount([], {
      ...DOCUMENT_TASK,
      document: {
        body: `## Flow\n\n![Inviting a member](${address} "The flow")\n`,
        assumptions: [],
      },
    });
    await settle();
    const block = container.querySelector<HTMLElement>(".picture-block[data-video]");
    const video = block?.querySelector("video");
    const seek = block?.querySelector<HTMLElement>('[aria-label="Seek"]');
    const named = (label: string) =>
      block?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined;
    const [play, fullScreen, expand] = ["Play", "Full screen", "Expand"].map(named);
    const caption = block?.querySelector<HTMLElement>(".picture-caption");
    assert.ok(
      video && seek && play && fullScreen && expand && caption,
      "the video plays in its section, under its caption",
    );

    // The frame, the scrubber, Play, and Full screen, each as a mouse's press lands on it, then Expand.
    for (const pressed of [video, seek, play, fullScreen]) {
      act(() => {
        pressed.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
        );
      });
    }
    act(() => expand.click());

    // Note that the check is a boolean, because a failing comparison would print the whole editor's DOM.
    assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");
    assert.ok(document.querySelector(".attachment-viewer"), "the Expand opened the viewer");

    act(() => {
      caption.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 12 }));
    });

    assert.ok(container.querySelector(".plan-document-editor") !== null, "the editor opened");
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
    if (fullScreen === undefined) Reflect.deleteProperty(Element.prototype, "requestFullscreen");
    else Object.defineProperty(Element.prototype, "requestFullscreen", fullScreen);
  }
});

test("a press on a task's checkbox ticks or clears that one item in the saved text, goes back where the save is refused and says so, and opens no editor", async () => {
  const body = [
    "## Goal",
    "Invite a *teammate*.",
    "",
    "## Steps",
    "- [ ] Send the invite",
    "  - [ ] Write the email",
    "* [X] Pick a role",
    "",
    "> 1. [ ] Quoted",
    "",
  ].join("\n");
  const { container, sent, render } = mount([
    { saved: true },
    { conflict: { current: body } },
    { saved: true },
  ]);
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } });
  await settle();
  const boxes = [...block(container, "Steps").querySelectorAll<HTMLElement>('[role="checkbox"]')];
  assert.deepEqual(
    boxes.map((box) => [
      box.getAttribute("aria-label"),
      box.getAttribute("aria-disabled") === "true",
      box.getAttribute("aria-checked") === "true",
    ]),
    [
      ["Send the invite", false, false],
      ["Write the email", false, false],
      ["Pick a role", false, true],
      ["Quoted", false, false],
    ],
  );
  const [, nested, ticked, quoted] = boxes;
  assert.ok(nested && ticked && quoted, "every box is drawn");

  for (const box of [nested, ticked, quoted]) {
    act(() => box.click());
    await settle();
  }

  // Note that the plan is not drawn again here, so each tick is written over the text the one before it saved.
  const written = body.replace("  - [ ] Write", "  - [x] Write");
  assert.deepEqual(
    sent.map((request) => request.document),
    [
      { base: body, value: written },
      { base: written, value: written.replace("* [X] Pick", "* [ ] Pick") },
      { base: written, value: written.replace("> 1. [ ] Quoted", "> 1. [x] Quoted") },
    ],
  );
  assert.equal(nested.getAttribute("aria-checked"), "true", "a saved tick stands");
  assert.equal(ticked.getAttribute("aria-checked"), "true", "a tick the save refused goes back");
  assert.equal(newestToastSays(), "The plan could not be saved.");
  // Note that the check is a boolean, because a failing comparison would print the whole editor's DOM.
  assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");
});

test("a press on the label around a task's checkbox, which takes a finger's press beside the box, ticks it once and opens no editor", async () => {
  const body = ["## Steps", "- [ ] Send the invite", ""].join("\n");
  const { container, sent, render } = mount([{ saved: true }]);
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } });
  await settle();
  const label = block(container, "Steps").querySelector<HTMLLabelElement>(
    ".luke-markdown-task > label",
  );
  assert.ok(label, "the box stands in its label");

  act(() => label.click());
  await settle();

  assert.deepEqual(
    sent.map((request) => request.document),
    [{ base: body, value: body.replace("- [ ] Send", "- [x] Send") }],
  );
  // Note that the check is a boolean, because a failing comparison would print the whole editor's DOM.
  assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");
});

test("a press while a tick is out waits its turn, and both land, the second over the text the first saved", async () => {
  const body = "## Steps\n- [ ] One\n- [ ] ![Upload screenshot](shot.png)\n";
  const answers = [
    Promise.withResolvers<TasksEditAnswer>(),
    Promise.withResolvers<TasksEditAnswer>(),
  ];
  const sent: PlanEditRequest[] = [];
  const door = (request: PlanEditRequest): Promise<TasksEditAnswer> => {
    sent.push(request);
    return answers[sent.length - 1]?.promise ?? Promise.resolve({ saved: true });
  };
  const { container, render } = mount();
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } }, door);
  await settle();
  const boxes = [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  assert.deepEqual(
    boxes.map((box) => box.getAttribute("aria-label")),
    ["One", "Upload screenshot"],
  );

  act(() => {
    for (const box of boxes) box.click();
  });
  await settle();
  assert.equal(sent.length, 1, "the second waits for the first");
  answers[0]?.resolve({ saved: true });
  await settle();
  answers[1]?.resolve({ saved: true });
  await settle();

  const first = body.replace("[ ] One", "[x] One");
  assert.deepEqual(
    sent.map((request) => request.document),
    [
      { base: body, value: first },
      { base: first, value: first.replace("[ ] ![Upload", "[x] ![Upload") },
    ],
  );
  assert.deepEqual(
    boxes.map((box) => box.getAttribute("aria-checked") === "true"),
    [true, true],
  );
  assert.equal(newestToastSays(), undefined, "nothing is said of ticks that saved");
});

test("a tick saved on one task is not carried into another whose plan reads the same", async () => {
  const body = "## Steps\n- [ ] One\n- [ ] Two\n";
  const { container, sent, render } = mount();
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } });
  await settle();
  const one = container.querySelector<HTMLElement>('[role="checkbox"][aria-label="One"]');
  assert.ok(one, "One is drawn");
  act(() => one.click());
  await settle();

  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  render({ ...other, document: { body, assumptions: [] } });
  await settle();
  const two = container.querySelector<HTMLElement>('[role="checkbox"][aria-label="Two"]');
  assert.ok(two, "Two is drawn");
  act(() => two.click());
  await settle();

  assert.deepEqual(sent.at(-1)?.document, {
    base: body,
    value: body.replace("[ ] Two", "[x] Two"),
  });
});

test("a plan drawn anew while a tick is out is what the next tick is written over", async () => {
  const body = "## Steps\n- [ ] One\n- [ ] Two\n";
  const lukes = `${body}\nLuke's line.\n`;
  const first = Promise.withResolvers<TasksEditAnswer>();
  const sent: PlanEditRequest[] = [];
  const door = (request: PlanEditRequest): Promise<TasksEditAnswer> => {
    sent.push(request);
    return sent.length === 1 ? first.promise : Promise.resolve({ saved: true });
  };
  const { container, render } = mount();
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } }, door);
  await settle();
  const one = container.querySelector<HTMLElement>('[role="checkbox"][aria-label="One"]');
  assert.ok(one, "One is drawn");
  act(() => one.click());
  await settle();

  render({ ...DOCUMENT_TASK, document: { body: lukes, assumptions: [] } }, door);
  first.resolve({ saved: true });
  await settle();
  const two = container.querySelector<HTMLElement>('[role="checkbox"][aria-label="Two"]');
  assert.ok(two, "Two is drawn");
  act(() => two.click());
  await settle();

  assert.deepEqual(sent.at(-1)?.document, {
    base: lukes,
    value: lukes.replace("[ ] Two", "[x] Two"),
  });
});

test("a tick the service did not answer goes back and says the plan could not be saved", async () => {
  const body = "## Steps\n- [ ] One\n";
  const { container, sent, render } = mount([{ failure: TASK_CALL_FAILURE.UNANSWERED }]);
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } });
  await settle();
  const box = container.querySelector<HTMLElement>('[role="checkbox"]');
  assert.ok(box, "the box is drawn");

  act(() => box.click());
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(box.getAttribute("aria-checked"), "false", "the box goes back");
  assert.equal(newestToastSays(), "The plan could not be saved.");
});

test("a box pressed twice while its first tick is out, whose first is refused, stands as last pressed", async () => {
  const body = "## Steps\n- [ ] One\n";
  const first = Promise.withResolvers<TasksEditAnswer>();
  const sent: PlanEditRequest[] = [];
  const door = (request: PlanEditRequest): Promise<TasksEditAnswer> => {
    sent.push(request);
    return first.promise;
  };
  const { container, render } = mount();
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } }, door);
  await settle();
  const box = container.querySelector<HTMLElement>('[role="checkbox"]');
  assert.ok(box, "the box is drawn");

  act(() => box.click());
  act(() => box.click());
  first.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED });
  await settle();

  assert.equal(sent.length, 1, "the second asks for what the plan already holds, so sends nothing");
  assert.equal(box.getAttribute("aria-checked"), "false");
  assert.equal(newestToastSays(), "The plan could not be saved.");
});

test("a press on the name in a section's byline opens no editor, while a press on the section's words still does", () => {
  const { container, render } = mount();
  const edit = { actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at: Date.now(), duringCall: false };
  render({ ...DOCUMENT_TASK, sectionEdits: [{ section: "Goal", ...edit }] });
  const goal = block(container, "Goal");
  const name = goal.querySelector(".plan-unit-byline [data-actor-ref]");
  assert.ok(name, "the byline names who last changed the section");

  act(() => {
    name.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Note that the check is a boolean, because a failing comparison would print the whole editor's DOM.
  assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");

  act(() => goal.click());
  assert.equal(open().markdown, BODY);
});

/** Where the text's words stand in the window, as a laid-out page draws them: from 100 to 300 down, and 50 to 650 across. */
function layTextOut(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 50, y: 100, width: 600, height: 200 }),
  );
}

/** A press on `target` at the point given, as the pointer's button goes down and comes up; answers whether the press was taken. */
function pressAt(target: Element, x: number, y: number): boolean {
  const down = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  act(() => {
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  });
  return down.defaultPrevented;
}

function scrollerOf(container: HTMLElement): HTMLElement {
  return (
    container.querySelector<HTMLElement>(".plan-document-body")?.parentElement ??
    assert.fail("the document scrolls")
  );
}

test("a press anywhere on an empty plan's room opens its text with the caret in it, leaving the press to the page", () => {
  layTextOut();
  const { container, render } = mount();
  render({ ...DOCUMENT_TASK, document: { body: "", assumptions: [] } });
  const scroller = scrollerOf(container);
  const body = container.querySelector(".plan-body") ?? assert.fail("the body");

  const taken = pressAt(scroller, 300, 900);

  assert.ok(!taken, "a drag from the room still selects, as a press on a page does");
  assert.equal(open().markdown, "");
  assert.deepEqual(open().placement, PLACEMENT_END);
  assert.equal(title(container).textContent, DOCUMENT_NAME, "the title stays over the text");
  assert.ok(body.contains(container.querySelector(".plan-document-editor")));
});

test("a press on a plan's room under its text opens it at the end, beside it on the nearest line, and above it nowhere", () => {
  layTextOut();
  const under = mount();
  pressAt(scrollerOf(under.container), 300, 500);
  const atEnd = open().placement;
  under.unmount();

  const beside = mount();
  pressAt(scrollerOf(beside.container), 10, 180);
  const onLine = open().placement;
  beside.unmount();

  const above = mount();
  const taken = pressAt(scrollerOf(above.container), 300, 40);

  assert.deepEqual(atEnd, PLACEMENT_END);
  assert.deepEqual(onLine, { x: 51, y: 180 }, "the nearest line, at the text's own edge");
  assert.ok(!taken, "a press above the text is not the text's");
  assert.ok(above.container.querySelector(".plan-document-editor") === null, "no editor opened");
});

test("a press on the room while the editor's bundle loads is where the editor opens", async () => {
  layTextOut();
  const landed = bundles;
  const gate = Promise.withResolvers<PlanEditorModule>();
  bundles = sideBundles({ planEditor: () => gate.promise });
  try {
    const { container } = mount();
    const scroller = scrollerOf(container);
    pressAt(scroller, 300, 500);
    pressAt(scroller, 10, 180);
    await act(async () => {
      gate.resolve(STAND_IN);
      await gate.promise;
    });
    await settle();

    assert.deepEqual(open().placement, { x: 51, y: 180 });
  } finally {
    bundles = landed;
  }
});

test("a press on the room with words selected only clears them, opening nothing", () => {
  layTextOut();
  const { container } = mount();
  const goal = block(container, "Goal");
  window.getSelection()?.selectAllChildren(goal);

  const taken = pressAt(scrollerOf(container), 300, 500);

  assert.ok(!taken, "the press clears the words, as a press anywhere does");
  assert.ok(container.querySelector(".plan-document-editor") === null, "no editor opened");
});

test("a press on the room while the text is open moves its caret there and keeps the editor open", () => {
  layTextOut();
  const { container } = mount();
  act(() => block(container, "Goal").click());
  const editor = mounted.at(-1) ?? assert.fail("an editor");

  const taken = pressAt(scrollerOf(container), 300, 500);

  assert.ok(taken, "the press keeps the keyboard in the editor");
  assert.deepEqual(editor.placed, [PLACEMENT_END]);
  assert.ok(!editor.destroyed, "the editor stays open");
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

test("words whose save is refused as the developer leaves the plan are kept, said in a toast that stands, and open again when they come back", async () => {
  const { container, sent, render } = mount([{ failure: TASK_CALL_FAILURE.UNANSWERED }]);
  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));

  render(other);
  await settle();

  assert.equal(sent.length, 1, "the save went as the plan was left");
  assert.equal(newestToastSays(), "Your plan edits could not be saved.Retry");

  render(DOCUMENT_TASK);
  await settle();

  assert.equal(open().markdown, `${BODY}Mine.\n`, "the editor opens on the kept words");
  assert.ok(container.textContent?.includes("Not saved: the service did not answer."));
  assert.equal(newestToastSays(), undefined, "the toast goes once the words are back");
  assert.equal(sent.length, 1, "nothing saves them on its own");
});

test("words typed and not yet saved are unsaved work, and once they save they are not", async () => {
  const { container } = mount();
  act(() => block(container, "Goal").click());
  assert.equal(unsavedWords(container), false, "an editor open on the plan's own words holds none");

  act(() => open().onDraft(`${BODY}Mine.\n`));
  assert.equal(unsavedWords(container), true);

  act(() => open().onFinish(1, FINISH.ESCAPE));
  await settle();
  assert.equal(unsavedWords(container), false);
});

test("words a plan was left with that its save refused stay unsaved work, there and back", async () => {
  const { container, render } = mount([{ failure: TASK_CALL_FAILURE.UNANSWERED }]);
  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));

  render(other);
  await settle();
  assert.equal(unsavedWords(container), true, "kept while another plan is open");

  render(DOCUMENT_TASK);
  await settle();
  assert.equal(unsavedWords(container), true, "and in the editor they open in again");
});

test("words a plan was left with stay unsaved work while their save is out, and not once it lands", async () => {
  let answer: (saved: TasksEditAnswer) => void = () => assert.fail("no save went");
  const { container, render } = mount();
  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  const held = () =>
    new Promise<TasksEditAnswer>((resolve) => {
      answer = resolve;
    });
  render(DOCUMENT_TASK, held);
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));

  render(other, held);
  await settle();
  assert.equal(unsavedWords(container), true, "the save is still out");

  answer({ saved: true });
  await settle();
  assert.equal(unsavedWords(container), false);
});

test("a plan left twice while its first save is out stays unsaved work until both saves answer", async () => {
  const answers: ((saved: TasksEditAnswer) => void)[] = [];
  const { container, render } = mount();
  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  const held = () =>
    new Promise<TasksEditAnswer>((resolve) => {
      answers.push(resolve);
    });
  const editAndLeave = async (words: string) => {
    render(DOCUMENT_TASK, held);
    await settle();
    act(() => block(container, "Goal").click());
    act(() => open().onDraft(words));
    render(other, held);
    await settle();
  };
  await editAndLeave(`${BODY}Mine.\n`);
  await editAndLeave(`${BODY}Mine again.\n`);
  assert.equal(answers.length, 2, "both saves are out");

  answers[0]?.({ saved: true });
  await settle();
  assert.equal(unsavedWords(container), true, "the newer save is still out");

  answers[1]?.({ saved: true });
  await settle();
  assert.equal(unsavedWords(container), false);
});

test("a title typed in is unsaved work until its rename answers", async () => {
  const { container, renamed } = mount();
  const words = title(container);

  act(() => {
    words.focus();
    words.textContent = "Beta";
    words.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(unsavedWords(container), true);

  act(() => words.blur());
  await settle();
  assert.deepEqual(renamed, ["Beta"]);
  assert.equal(unsavedWords(container), false);
});

test("the plan's title is the page's one h1, and editing it in place still renames the plan", async () => {
  const { container, renamed } = mount();

  const headings = container.querySelectorAll("h1");
  assert.equal(headings.length, 1, "the plan page names itself once");
  assert.equal(headings[0]?.textContent, DOCUMENT_NAME);
  assert.ok(headings[0]?.contains(title(container)), "the title edited is the h1's own words");

  act(() => {
    title(container).focus();
    title(container).textContent = "Beta";
    title(container).dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => title(container).blur());
  await settle();

  assert.deepEqual(renamed, ["Beta"]);
  assert.equal(container.querySelector("h1")?.textContent, "Beta");
});

test("a conflict over a teammate's words names them on its note and its button, which takes their words and closes the editor", async () => {
  const theirs = `${BODY}Charles's.\n`;
  const by = { actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at: Date.now(), duringCall: false };
  const { container, sent } = mount([{ conflict: { current: theirs, by } }]);
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));
  act(() => open().onFinish(1, FINISH.ESCAPE));
  await settle();

  const note = container.querySelector(".plan-editor-note");
  assert.equal(
    note?.querySelector("span")?.textContent,
    "Charles Pan changed this section while you were editing.",
  );
  const take = [...(note?.querySelectorAll("button") ?? [])].at(-1);
  assert.equal(take?.textContent, "Use Charles Pan’s");

  act(() => take?.click());
  await settle();

  assert.equal(sent.length, 1, "taking their words saves nothing");
  assert.ok(container.querySelector(".plan-document-editor") === null, "the editor closed");
});

test("Keep mine in the open editor over a teammate's change to another section lays the merged words into it and saves both changes", async () => {
  const theirs = BODY.replace("Only an admin", "Only an owner");
  const mine = BODY.replace("Invites land by email.", "Invites land by email or link.");
  const merged = theirs.replace("Invites land by email.", "Invites land by email or link.");
  const by = { actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at: Date.now(), duringCall: false };
  const { container, sent } = mount([{ conflict: { current: theirs, by } }]);
  act(() => block(container, "Goal").click());
  const [editor] = mounted;
  act(() => open().onDraft(mine));
  act(() => open().onFinish(1, FINISH.ESCAPE));
  await settle();

  const keep = container.querySelector(".plan-editor-note")?.querySelector("button");
  assert.equal(keep?.textContent, "Keep mine");
  act(() => keep?.click());
  await settle();

  assert.deepEqual(editor?.took, [[mine, merged]]);
  assert.deepEqual(sent, [
    { document: { base: BODY, value: mine } },
    { document: { base: theirs, value: merged } },
  ]);
});

test("words left waiting on a conflict are kept and said, and the toast's Keep mine saves them beside Luke's", async () => {
  const lukes = `${BODY}Luke's.\n`;
  const by = { actor: PLAN_ACTOR.NOTETAKER, at: Date.now(), duringCall: true };
  const lukesNote = "Luke changed this section while you were editing.";
  const { container, sent, render } = mount([{ conflict: { current: lukes, by } }]);
  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));
  act(() => open().onFinish(1, FINISH.ESCAPE));
  await settle();
  assert.ok(container.textContent?.includes(lukesNote), "the conflict holds the editor open");

  render(other);
  await settle();

  assert.equal(sent.length, 1, "a conflict sends nothing more as the plan is left");
  assert.equal(newestToastSays(), `Your plan edits could not be saved.${lukesNote}Keep mine`);

  act(() => newestToastAction()?.click());
  await settle();

  assert.deepEqual(sent.at(-1), { document: { base: lukes, value: `${lukes}Mine.\n` } });
  assert.equal(newestToastSays(), undefined);
  render(DOCUMENT_TASK);
  await settle();
  assert.equal(
    container.querySelector(".plan-document-editor"),
    null,
    "nothing is left to open on once they saved",
  );
});

test("the toast's Retry over words a refused save left saves them to the plan they were typed in, though the page has opened another since", async () => {
  const { container, renderPage } = mount();
  const doors: [string, PlanEditRequest][] = [];
  const answers: TasksEditAnswer[] = [{ failure: TASK_CALL_FAILURE.UNANSWERED }, { saved: true }];
  const edit: TaskEdit = (taskId, request) => {
    doors.push([taskId, request]);
    return Promise.resolve<TasksEditAnswer>(answers[doors.length - 1] ?? { saved: true });
  };
  const other = { ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" };
  renderPage(DOCUMENT_TASK, edit);
  act(() => block(container, "Goal").click());
  act(() => open().onDraft(`${BODY}Mine.\n`));
  renderPage(other, edit);
  await settle();

  act(() => newestToastAction()?.click());
  await settle();

  const mine = { document: { base: BODY, value: `${BODY}Mine.\n` } };
  assert.deepEqual(doors, [
    [DOCUMENT_TASK.id, mine],
    [DOCUMENT_TASK.id, mine],
  ]);
  assert.equal(newestToastSays(), undefined);
});

/** A browser's answer to where a point stands in the page's words: `offset` into `words`, its line `top` down the window. */
function pointLandsOn(words: Text, offset: number, top: number): void {
  const range = document.createRange();
  range.setStart(words, offset);
  Object.defineProperty(range, "getClientRects", {
    value: () => [DOMRect.fromRect({ x: 0, y: top, width: 0, height: 20 })],
  });
  Object.defineProperty(document, "caretRangeFromPoint", {
    configurable: true,
    value: () => range,
  });
}

/** The text node of `words` drawn in `within`, the `nth` (from 0) where several are. */
function wordsNode(within: HTMLElement, words: string, nth = 0): Text {
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let at = walker.nextNode(); at !== null; at = walker.nextNode()) {
    if (at instanceof Text && at.data === words) found.push(at);
  }
  return found[nth] ?? assert.fail(`the words ${words}`);
}

test("a click hands the editor the words it landed on, so the caret finds them however the editor draws what stands above", () => {
  const body = "## Goal\n\nShip it.\n\nShip it.\n";
  const { container, render } = mount();
  render({ ...DOCUMENT_TASK, document: { body, assumptions: [] } });
  const goal = block(container, "Goal");
  pointLandsOn(wordsNode(goal, "Ship it.", 1), 5, 300);
  try {
    act(() => {
      goal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 60, clientY: 310 }));
    });
  } finally {
    Reflect.deleteProperty(document, "caretRangeFromPoint");
  }

  assert.deepEqual(open().placement, {
    x: 60,
    y: 310,
    words: { section: 0, text: "Ship it.", occurrence: 1, offset: 5, code: false, top: 300 },
  });
});

test("the words a click opened the editor on stay under the finger, as it opens and as what it draws later changes its height, until the developer scrolls", () => {
  const { container } = mount();
  const goal = block(container, "Goal");
  const scroller = scrollerOf(container);
  scroller.scrollTop = 500;
  pointLandsOn(wordsNode(goal, "Invites land by email."), 3, 300);
  // The words stand this far down the column in the editor: 59 lower than the text drew them, for a taller picture above.
  let wordsDown = 859;
  wordsLine = () => wordsDown - scroller.scrollTop;
  try {
    act(() => {
      goal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 60, clientY: 310 }));
    });
  } finally {
    Reflect.deleteProperty(document, "caretRangeFromPoint");
  }
  assert.equal(wordsLine(), 300, "the words stand where they were clicked as the editor opens");

  // A diagram's preview above them lands later, 200 tall.
  wordsDown += 200;
  act(() => relayout());
  assert.equal(wordsLine(), 300, "and again once the preview has drawn");

  act(() => {
    scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  });
  wordsDown += 100;
  act(() => relayout());
  assert.equal(wordsLine(), 400, "a scroll of the developer's lets the words go");
});

test("a click whose words the editor did not find scrolls nothing", () => {
  const { container } = mount();
  const goal = block(container, "Goal");
  const scroller = scrollerOf(container);
  scroller.scrollTop = 500;
  pointLandsOn(wordsNode(goal, "Invites land by email."), 3, 300);
  try {
    act(() => {
      goal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 60, clientY: 310 }));
    });
  } finally {
    Reflect.deleteProperty(document, "caretRangeFromPoint");
  }

  assert.ok(open().placement !== undefined, "the editor opened");
  assert.equal(scroller.scrollTop, 500);
});

test("a press on the room after a click while the editor's bundle loads opens the editor where the room says, scrolling nothing for the click's words", async () => {
  layTextOut();
  const landed = bundles;
  const gate = Promise.withResolvers<PlanEditorModule>();
  bundles = sideBundles({ planEditor: () => gate.promise });
  try {
    const { container } = mount();
    const scroller = scrollerOf(container);
    scroller.scrollTop = 500;
    pointLandsOn(wordsNode(block(container, "Goal"), "Invites land by email."), 3, 300);
    try {
      act(() => {
        block(container, "Goal").dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 60, clientY: 310 }),
        );
      });
    } finally {
      Reflect.deleteProperty(document, "caretRangeFromPoint");
    }
    pressAt(scroller, 300, 500);
    wordsLine = () => 700;
    await act(async () => {
      gate.resolve(STAND_IN);
      await gate.promise;
    });
    await settle();

    assert.deepEqual(open().placement, PLACEMENT_END);
    assert.equal(scroller.scrollTop, 500);
  } finally {
    bundles = landed;
  }
});

test("the words the caret stood on stay where they stood as the editor closes, the column scrolled by as much as the drawn text moved them", async () => {
  const { container } = mount();
  act(() => block(container, "Goal").click());
  const scroller = scrollerOf(container);
  scroller.scrollTop = 500;
  // The caret's line stands 300 down the window in the editor; the drawn text, with a shorter diagram above, draws it 57 down.
  caretOn = {
    section: 1,
    text: "Invites land by email.",
    occurrence: 0,
    offset: 3,
    code: false,
    top: 300,
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 57, width: 300, height: 20 }),
  );

  act(() => open().onFinish(1, FINISH.ESCAPE));
  await settle();

  assert.ok(container.querySelector(".plan-document-editor") === null, "the editor closed");
  assert.equal(scroller.scrollTop, 500 + 57 - 300);
});

test("an editor closing with its caret on no words scrolls nothing", async () => {
  const { container } = mount();
  act(() => block(container, "Goal").click());
  const scroller = scrollerOf(container);
  scroller.scrollTop = 500;

  act(() => open().onFinish(1, FINISH.ESCAPE));
  await settle();

  assert.equal(scroller.scrollTop, 500);
});

test("words left by an editor closed as another plan opens move nothing in it", async () => {
  const { container, render } = mount();
  act(() => block(container, "Goal").click());
  const scroller = scrollerOf(container);
  scroller.scrollTop = 500;
  caretOn = {
    section: 1,
    text: "Invites land by email.",
    occurrence: 0,
    offset: 3,
    code: false,
    top: 300,
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 57, width: 300, height: 20 }),
  );

  // Another plan with the same words opens in its place.
  render({ ...DOCUMENT_TASK, id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40" });
  await settle();

  assert.ok(container.querySelector(".plan-document-editor") === null, "the editor closed");
  assert.equal(scroller.scrollTop, 500);
});

/** The plan as a teammate's save left it: their text, saved after the one the page opened on, by them. */
function savedBy(body: string, updatedAt: number, by = CHARLES): Task {
  return {
    ...DOCUMENT_TASK,
    updatedAt,
    document: { ...DOCUMENT_TASK.document, body },
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by, at: updatedAt, duringCall: false },
  };
}

test("a teammate's save reaching an open editor holding nothing unsaved is laid into it, and the editor's next save is a change from their text", async () => {
  const theirs = `${BODY}Charles's.\n`;
  const { container, sent, render } = mount();
  act(() => block(container, "Goal").click());
  const [editor] = mounted;

  render(savedBy(theirs, 3));
  await settle();

  assert.deepEqual(editor?.took, [[BODY, theirs]]);
  act(() => open().onDraft(`${theirs}Mine.\n`));
  act(() => open().onFinish(1, FINISH.ESCAPE));
  await settle();
  assert.deepEqual(sent, [{ document: { base: theirs, value: `${theirs}Mine.\n` } }]);
});

test("an open editor holding unsaved words keeps them as a teammate saves, saves them as a change from what it opened on, and takes the merged answer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const mine = `${BODY}Mine.\n`;
    const merged = `${BODY}Charles's.\n\nMine.\n`;
    const sent: PlanEditRequest[] = [];
    let answer: (answered: TasksEditAnswer) => void = () => undefined;
    const door = (request: PlanEditRequest) => {
      sent.push(request);
      return new Promise<TasksEditAnswer>((resolve) => {
        answer = resolve;
      });
    };
    const { container, render } = mount();
    render(DOCUMENT_TASK, door);
    act(() => block(container, "Goal").click());
    const [editor] = mounted;
    act(() => open().onDraft(mine));
    // The editor hands its words over once the typing pauses.
    act(() => vi.advanceTimersByTime(200));

    render(savedBy(`${BODY}Charles's.\n`, 3), door);
    await settle();
    assert.deepEqual(editor?.took, [], "nothing is laid over words not yet saved");

    // The words save a beat later, as a change from the text they were typed over, which the service lays over Charles's.
    act(() => vi.advanceTimersByTime(1_000));
    await settle();
    assert.deepEqual(sent, [{ document: { base: BODY, value: mine } }]);

    // The host draws the plan the save answered, the developer's last, before the save's answer arrives.
    render(savedBy(merged, 4, { userId: "user-me", name: "Me" }), door);
    answer({ saved: true });
    await settle();
    assert.deepEqual(editor?.took, [[mine, merged]]);
  } finally {
    vi.useRealTimers();
  }
});
