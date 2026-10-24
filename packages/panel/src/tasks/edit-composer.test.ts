// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAttachment, CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { type AgentPictureDoor, AgentPicturesProvider } from "./agent-pictures.js";
import { EditComposer } from "./edit-composer.js";

/**
 * One of the developer's lines written again where it stands, in the
 * agent's own box: it opens on the line's words and the file it carried,
 * Send hands on what the box then holds, and Cancel and Escape send
 * nothing and keep what was written for the next Edit of the line.
 */

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** A line of the developer's that carried one picture inline. */
const LINE: CodingAgentMessage = {
  id: "line-2",
  role: MESSAGE_ROLE.USER,
  parts: [
    { type: "text", text: "Also email the inviter." },
    {
      type: "file",
      mediaType: "image/png",
      filename: "invite-expired.png",
      url: `data:image/png;base64,${PIXEL}`,
    },
  ],
};

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The line's box mounted in the window `registry` stands for, every way it ended written down, its pictures read through `door` where one is handed. */
async function opened(
  line: CodingAgentMessage = LINE,
  door?: AgentPictureDoor,
  words = "Also email the inviter.",
  registry = AtomRegistry.make(),
) {
  const ended: { words: string; files: readonly CodingAgentAttachment[] }[] = [];
  let cancelled = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        registry,
        createElement(
          AgentPicturesProvider,
          { value: door },
          createElement(EditComposer, {
            message: line,
            words,
            edit: {
              agentId: "agent-1",
              doors: { openGitHub: () => undefined, copy: () => undefined },
              dictates: true,
              cuts: false,
              onCancel: () => {
                cancelled += 1;
              },
              onSend: (words, files) => ended.push({ words, files }),
            },
          }),
        ),
      ),
    ),
  );
  await settle();
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (each) => each.textContent === name || each.getAttribute("aria-label") === name,
    );
  const close = () => act(() => root.unmount());
  return { container, ended, cancelled: () => cancelled, button, close };
}

test("it opens on the line's words and the file it carried, and Send hands on what it then holds", async () => {
  const box = await opened();

  assert.equal(composerEditor(box.container).textContent, "Also email the inviter.");
  typeInComposer(box.container, " Use their address.");
  pressInComposer(box.container, "Enter");
  await settle();

  assert.deepEqual(box.ended, [
    {
      words: "Also email the inviter. Use their address.",
      files: [{ name: "invite-expired.png", mediaType: "image/png", data: PIXEL }],
    },
  ]);
});

test("Cancel and Escape close it and send nothing", async () => {
  const box = await opened();

  const cancel = box.button("Cancel");
  assert.ok(cancel !== undefined);
  act(() => cancel.click());
  pressInComposer(box.container, "Escape");

  assert.equal(box.cancelled(), 2);
  assert.deepEqual(box.ended, []);
});

test("what was written is there again when Edit opens the line after an Escape, and a send lets it go", async () => {
  const registry = AtomRegistry.make();
  const first = await opened(LINE, undefined, "Also email the inviter.", registry);
  typeInComposer(first.container, " Use their address.");
  pressInComposer(first.container, "Escape");
  assert.equal(first.cancelled(), 1);
  first.close();

  const again = await opened(LINE, undefined, "Also email the inviter.", registry);
  assert.equal(
    composerEditor(again.container).textContent,
    "Also email the inviter. Use their address.",
  );
  pressInComposer(again.container, "Enter");
  await settle();
  assert.deepEqual(again.ended, [
    {
      words: "Also email the inviter. Use their address.",
      files: [{ name: "invite-expired.png", mediaType: "image/png", data: PIXEL }],
    },
  ]);
  again.close();

  const sent = await opened(LINE, undefined, "Also email the inviter.", registry);
  assert.equal(composerEditor(sent.container).textContent, "Also email the inviter.");
});

test("a file taken off before an Escape stays off when Edit opens the line again, after a relaunch too", async () => {
  const first = await opened(LINE, undefined, "Also email the inviter.");
  const remove = first.button(`Remove invite-expired.png`);
  assert.ok(remove !== undefined, "the file's chip offers its removal");
  act(() => remove.click());
  pressInComposer(first.container, "Escape");
  first.close();

  // A window of its own, as a relaunch opens, which finds the draft's words and none of its files.
  const again = await opened(LINE, undefined, "Also email the inviter.", AtomRegistry.make());
  pressInComposer(again.container, "Enter");
  await settle();
  assert.deepEqual(again.ended, [{ words: "Also email the inviter.", files: [] }]);
});

test("one of two like files taken off stays off after a relaunch, and the other goes", async () => {
  const picture = {
    type: "file",
    mediaType: "image/png",
    filename: "invite-expired.png",
    url: `data:image/png;base64,${PIXEL}`,
  };
  const twice: CodingAgentMessage = {
    ...LINE,
    parts: [{ type: "text", text: "Also email the inviter." }, picture, picture],
  };
  const first = await opened(twice, undefined, "Also email the inviter.");
  const remove = first.button(`Remove invite-expired.png`);
  assert.ok(remove !== undefined, "the file's chip offers its removal");
  act(() => remove.click());
  pressInComposer(first.container, "Escape");
  first.close();

  const again = await opened(twice, undefined, "Also email the inviter.", AtomRegistry.make());
  pressInComposer(again.container, "Enter");
  await settle();
  assert.deepEqual(again.ended, [
    {
      words: "Also email the inviter.",
      files: [{ name: "invite-expired.png", mediaType: "image/png", data: PIXEL }],
    },
  ]);
});

/** A line whose picture was kept apart, which the window reads through the agent's door. */
const KEPT: CodingAgentMessage = {
  id: "line-3",
  role: MESSAGE_ROLE.USER,
  parts: [
    { type: "text", text: "And this one." },
    {
      type: "file",
      mediaType: "image/png",
      filename: "kept.png",
      url: "",
      providerMetadata: { luke: { attachmentId: "picture-1" } },
    },
  ],
};

test("a picture that lands after words were written goes with them when Edit opens the line again", async () => {
  let land: (() => void) | undefined;
  const door: AgentPictureDoor = {
    owner: `owner-${Math.random()}`,
    read: () =>
      new Promise((resolve) => {
        land = () => resolve({ contentType: "image/png", base64: PIXEL });
      }),
  };
  const registry = AtomRegistry.make();
  const first = await opened(KEPT, door, "And this one.", registry);
  typeInComposer(first.container, " Look closely.");
  await act(async () => land?.());
  await settle();
  pressInComposer(first.container, "Escape");
  first.close();

  const again = await opened(KEPT, door, "And this one.", registry);
  pressInComposer(again.container, "Enter");
  await settle();
  assert.deepEqual(again.ended, [
    {
      words: "And this one. Look closely.",
      files: [{ name: "kept.png", mediaType: "image/png", data: PIXEL }],
    },
  ]);
});

test("a picture still being read holds Send, and joins the box once it lands", async () => {
  let land: (() => void) | undefined;
  const door: AgentPictureDoor = {
    owner: `owner-${Math.random()}`,
    read: () =>
      new Promise((resolve) => {
        land = () => resolve({ contentType: "image/png", base64: PIXEL });
      }),
  };
  const box = await opened(KEPT, door, "And this one.");

  pressInComposer(box.container, "Enter");
  await settle();
  assert.deepEqual(box.ended, [], "nothing goes while the picture is read");

  await act(async () => land?.());
  await settle();
  pressInComposer(box.container, "Enter");
  await settle();

  assert.deepEqual(box.ended, [
    {
      words: "And this one.",
      files: [{ name: "kept.png", mediaType: "image/png", data: PIXEL }],
    },
  ]);
});
