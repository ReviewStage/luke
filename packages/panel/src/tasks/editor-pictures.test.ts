// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { descriptionAttachmentAddress } from "@repo/features/description-attachment-link";
import type { Task } from "@repo/features/task-wire";
import { PICTURE_KEEP_FAILURE, type TasksPictureKeepAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { fakeActPort, fakeActPortCalls, fakeAppBridge } from "../testing/app-bridge.js";
import { readExperiments } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { relayout } from "../testing/resize-observer.js";
import { DescriptionBody } from "./description-body.js";
import { descriptionEditMutation } from "./description-edit-mutation.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";

beforeAll(() => readExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS)));

const TASK_ID = "4b1c2d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const KEPT_ID = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";

const TASK: Task = {
  ...DOCUMENT_TASK,
  id: TASK_ID,
  document: { body: "## Approach\n\nThe invite email follows the mock.\n", assumptions: [] },
};

const PAGE: TaskMentionsValue = {
  holder: { taskId: TASK_ID },
  taskName: "Invitations",
  workspace: "acme",
  repository: null,
  text: () => TASK.document.body,
  doors: {
    holder: { taskId: TASK_ID },
    place: { workspace: "acme", repository: null },
    anchors: new Set(["approach"]),
    onOpenTask: () => undefined,
    onOpenFile: () => undefined,
  },
};

const SECTION_LINKS = {
  workspace: "acme",
  onOpen: () => undefined,
  onOpenFile: () => undefined,
  reveal: undefined,
};

const roots: Root[] = [];

const saved: string[] = [];

let keeping: { resolve: (answer: TasksPictureKeepAnswer) => void } | undefined;

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installEditorLayout();
  fakeAppBridge({});
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_PICTURE_KEEP]: () =>
      new Promise((resolve) => {
        keeping = { resolve };
      }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  saved.length = 0;
  keeping = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function drawn(node: ReactNode): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(withQueryClient(createElement(TaskMentions, { value: PAGE, children: node }))),
  );
  return container;
}

async function editing(): Promise<HTMLElement> {
  const container = drawn(
    createElement(DescriptionBody, {
      task: TASK,
      edit: descriptionEditMutation(TASK.id, (request) => {
        saved.push(request.document.value);
        return Promise.resolve({ saved: true });
      }),
      sectionLinks: SECTION_LINKS,
    }),
  );
  const section = container.querySelector<HTMLElement>('[role="group"][aria-label="Approach"]');
  assert.ok(section !== null);
  act(() => section.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  return container;
}

async function pasteScreenshot(container: HTMLElement): Promise<void> {
  const editable = container.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const screenshot = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "image.png",
    {
      type: "image/png",
    },
  );
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [screenshot], types: ["Files"], getData: () => "" },
  });
  act(() => {
    editable.dispatchEvent(paste);
  });
  await settle();
}

async function keepAsked(): Promise<void> {
  for (let tries = 0; tries < 20 && keeping === undefined; tries += 1) await settle();
  assert.ok(keeping, "a keep is asked");
}

async function answerKeep(value: TasksPictureKeepAnswer): Promise<void> {
  const held = keeping ?? assert.fail("a keep is asked");
  act(() => held.resolve(value));
  await settle();
}

test("a pasted picture is drawn at once, dimmed, saying it is uploading, and as the kept picture once the service kept it", async () => {
  const container = await editing();

  await pasteScreenshot(container);
  await keepAsked();

  const uploading = container.querySelector(".picture-block[data-upload]");
  assert.equal(uploading?.getAttribute("data-upload"), "sending");
  assert.ok(
    uploading?.querySelector("img")?.getAttribute("src")?.startsWith("data:image/png;base64,"),
  );
  assert.equal(
    uploading?.querySelector(".picture-status")?.textContent?.includes("Uploading"),
    true,
  );

  await answerKeep({ id: KEPT_ID });

  assert.equal(container.querySelector(".picture-block[data-upload]"), null);
  const kept = container.querySelector(".editor-picture .picture-block[data-state='ready'] img");
  assert.equal(kept?.getAttribute("alt"), "Screenshot");
  assert.ok(kept?.getAttribute("src")?.startsWith("data:image/png;base64,"));
});

test("a keep that failed says why with Retry and Remove, and Remove takes the picture out", async () => {
  const container = await editing();
  await pasteScreenshot(container);
  await keepAsked();

  await answerKeep({ failure: PICTURE_KEEP_FAILURE.TOO_MANY });

  const failed = container.querySelector(".picture-block[data-upload='failed'] [role='alert']");
  assert.equal(
    failed?.textContent,
    "This description already holds as many pictures as it can.RetryRemove",
  );
  const [retry, remove] = [...(failed?.querySelectorAll("button") ?? [])];
  assert.equal(retry?.textContent, "Retry");
  assert.equal(remove?.textContent, "Remove");
  act(() => remove?.click());
  await settle();
  assert.equal(container.querySelector(".editor-picture"), null);
});

test("a video of another description pasted in is kept on this description as it is, waiting as a quiet box", async () => {
  const OTHER_TASK = "6e2f4a8b-1c3d-4e5f-9a0b-2c4d6e8f0a1b";
  const video = `data:${CONVERSATION_MEDIA_TYPE.WEBM};base64,GkXfow==`;
  const kept: string[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.TASKS_PICTURE_READ]: ({ planId }) =>
      Promise.resolve(
        planId === OTHER_TASK
          ? { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: "GkXfow==" }
          : { failure: "not-found" },
      ),
    [ACT_KIND.TASKS_PICTURE_KEEP]: ({ picture }) => {
      kept.push(picture);
      return new Promise((resolve) => {
        keeping = { resolve };
      });
    },
  });
  const container = await editing();
  const editable = container.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const address = descriptionAttachmentAddress(
    { taskId: OTHER_TASK, attachmentId: "9a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d" },
    "acme",
  );
  const html = `<img src="${address}" alt="Inviting a member">`;
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: {
      files: [],
      types: ["text/html"],
      getData: (type: string) => (type === "text/html" ? html : ""),
    },
  });
  act(() => {
    editable.dispatchEvent(paste);
  });

  await keepAsked();

  assert.deepEqual(kept, [video]);
  const uploading = container.querySelector(".picture-block[data-upload='sending']");
  assert.ok(uploading?.querySelector(".picture-pending"), "the video waits as a quiet box");
  assert.equal(uploading?.querySelector("img"), null);
});

test("Insert image is offered while the description's text is edited, and lays in the files chosen", async () => {
  const reading = drawn(
    createElement(DescriptionBody, { task: TASK, sectionLinks: SECTION_LINKS }),
  );
  assert.equal(appCommandOffered(APP_COMMAND.INSERT_PICTURE), false);
  act(() => roots.pop()?.unmount());
  reading.remove();

  const container = await editing();
  assert.equal(appCommandOffered(APP_COMMAND.INSERT_PICTURE), true);
  const chooser = container.querySelector<HTMLInputElement>("input[type='file']");
  assert.ok(chooser !== null);
  let chose = false;
  chooser.addEventListener("click", () => {
    chose = true;
  });
  act(() => {
    runAppCommand(APP_COMMAND.INSERT_PICTURE);
  });
  Object.defineProperty(chooser, "files", {
    configurable: true,
    value: [
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "members.png", { type: "image/png" }),
    ],
  });
  act(() => {
    chooser.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();

  assert.equal(chose, true);
  assert.ok(container.querySelector(".picture-block[data-upload='sending']"));
});

test("Escape while a picture is being kept leaves the editor open until it is, then closes with the picture in the text", async () => {
  const container = await editing();
  await pasteScreenshot(container);
  await keepAsked();
  const editable = container.querySelector(".ProseMirror") ?? assert.fail("the editor stands");

  act(() => {
    editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
  assert.ok(container.querySelector(".ProseMirror"), "the editor waits for the picture");

  await answerKeep({ id: KEPT_ID });

  assert.ok(
    container.querySelector(".ProseMirror") === null,
    "the editor closed once the picture was kept",
  );
  assert.ok(
    saved
      .at(-1)
      ?.includes(`![Screenshot](https://vespin.dev/acme/task/${TASK_ID}/files/${KEPT_ID})`),
    "the saved text names the kept picture",
  );
});

function selectPicture(container: HTMLElement): HTMLElement {
  const editable =
    container.querySelector<TiptapEditorHTMLElement>(".ProseMirror") ??
    assert.fail("the editor stands");
  const editor = editable.editor ?? assert.fail("the editor runs");
  let at: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") at = pos;
  });
  act(() => {
    editor.commands.setNodeSelection(at ?? assert.fail("the picture is in the text"));
  });
  return (
    container.querySelector<HTMLElement>(".editor-picture [role='toolbar']") ??
    assert.fail("the selected picture offers its tools")
  );
}

function layOutColumn(container: HTMLElement, width: number): void {
  const column =
    container.querySelector<HTMLElement>(".editor-picture") ?? assert.fail("the picture stands");
  const frame =
    column.querySelector<HTMLElement>(".picture-frame") ?? assert.fail("the picture is framed");
  column.getBoundingClientRect = () => new DOMRect(0, 200, width, 600);
  frame.getBoundingClientRect = () => new DOMRect(0, 200, width / 2, 600);
  act(() => relayout());
}

test("in a column too narrow for their names, a selected picture's tools are each still named", async () => {
  const container = await editing();
  await pasteScreenshot(container);
  await keepAsked();
  await answerKeep({ id: KEPT_ID });

  const tools = selectPicture(container);
  layOutColumn(container, 280);
  assert.deepEqual(
    [...tools.querySelectorAll("button")].map((button) => button.textContent),
    ["Alt text", "Caption", "Enlarge", "Delete"],
  );
});
