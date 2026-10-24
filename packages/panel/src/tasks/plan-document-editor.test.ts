// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import type { TasksEditAnswer } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { DIAGRAM_DRAWING, type DiagramModule } from "@luke/ui/diagram-contract";
import { Effect } from "effect";
import { act, createElement } from "react";
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
import { DOCUMENT_NAME, DOCUMENT_TASK } from "../testing/document-task.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { PlanBody } from "./plan-body.js";

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

afterEach(() => {
  releaseMotion();
  wordsLine = undefined;
  caretOn = undefined;
  vi.restoreAllMocks();
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
function mount(answers: readonly TasksEditAnswer[] = [], first: Task = DOCUMENT_TASK) {
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
    act(() =>
      root.render(
        onSideBundles(
          bundles,
          createElement(PlanBody, { task, live: false, onEdit: door, onRename }),
        ),
      ),
    );
  render(first);
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
  // Note that a section's arrival light is left out, since it comes and goes with the reveal's frames and moves nothing.
  const worn = [...(drawn?.classList ?? [])].filter((name) => name !== "plan-fresh");
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

test("a press on a task's checkbox ticks or clears that one item in the saved text, goes back where the save is refused, and opens no editor", async () => {
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

  assert.deepEqual(
    sent.map((request) => request.document),
    [
      { base: body, value: body.replace("  - [ ] Write", "  - [x] Write") },
      { base: body, value: body.replace("* [X] Pick", "* [ ] Pick") },
      { base: body, value: body.replace("> 1. [ ] Quoted", "> 1. [x] Quoted") },
    ],
  );
  assert.equal(nested.getAttribute("aria-checked"), "true", "a saved tick stands");
  assert.equal(ticked.getAttribute("aria-checked"), "true", "a tick the save refused goes back");
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

test("a press while a tick is out sends nothing and goes back, and a box is named by its item's words or its picture's", async () => {
  const body = "## Steps\n- [ ] One\n- [ ] ![Upload screenshot](shot.png)\n";
  const first = Promise.withResolvers<TasksEditAnswer>();
  const sent: PlanEditRequest[] = [];
  const door = (request: PlanEditRequest): Promise<TasksEditAnswer> => {
    sent.push(request);
    return first.promise;
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
  first.resolve({ saved: true });
  await settle();

  assert.deepEqual(
    sent.map((request) => request.document),
    [{ base: body, value: body.replace("[ ] One", "[x] One") }],
  );
  assert.deepEqual(
    boxes.map((box) => box.getAttribute("aria-checked") === "true"),
    [true, false],
  );
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
