// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentAgentAnswer } from "@repo/features/agent-view";
import type { TaskFileRequest } from "@repo/features/task-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import {
  fakeActPort,
  fakeActPortCalls,
  fakeAppBridge,
  readingFiles,
} from "../testing/app-bridge.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
} from "../testing/composer.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import {
  installScrollTo,
  pressLineNumber,
  wholeFileDrawn,
  wholeFileRoot,
} from "../testing/whole-file.js";
import { AgentComposer } from "./agent-composer.js";
import { FileTab } from "./file-tab.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { type MessageSender, useAgentComposer } from "./use-agent-composer.js";

const TASK_ID = "pl_1";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

const ignore = () => undefined;

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installScrollTo();
  installEditorLayout();
  fakeAppBridge({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

const PAGE: TaskMentionsValue = {
  holder: { taskId: TASK_ID },
  taskName: "Invitations",
  workspace: "acme",
  repository: "acme/relay",
  text: () => "## Goal\n\nInvite by email.\n",
  doors: {
    holder: { taskId: TASK_ID },
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(["goal"]),
    onOpenTask: ignore,
    onOpenFile: undefined,
  },
};

const readFile = (request: TaskFileRequest): Promise<TasksFileAnswer> =>
  Promise.resolve(
    request.raw === true
      ? {
          text: {
            path: "src/invite.ts",
            repository: "acme/relay",
            branch: "main",
            text: "one\ntwo\nthree\nfour\n",
          },
        }
      : {
          file: {
            path: "src/invite.ts",
            repository: "acme/relay",
            branch: "main",
            commit: HEAD,
            firstLine: 1,
            lineCount: 4,
            lines: ["one"],
          },
        },
  );

function Box({ sender }: { sender: MessageSender }): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: TASK_ID,
    messages: [],
    send: sender,
  });
  return createElement(AgentComposer, {
    ...QUIET_COMPOSER,
    composer,
    skills: () => Promise.resolve({ skills: [] }),
  });
}

async function page({ box = true }: { box?: boolean } = {}) {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise<AgentAgentAnswer>(ignore);
  };
  fakeActPort({ ...fakeActPortCalls(), ...readingFiles(readFile) });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(TaskMentions, {
          value: PAGE,
          children: [
            createElement(FileTab, {
              key: "file",
              place: { taskId: "task-1" },
              file: { path: "src/invite.ts", range: undefined, opened: 1 },
              onRead: ignore,
            }),
            box ? createElement(Box, { key: "box", sender }) : null,
          ],
        }),
      ),
    ),
  );
  await settle();
  await wholeFileDrawn(container);
  return { container, sent };
}

function lineText(container: HTMLElement, line: number): Node {
  const text = wholeFileRoot(container)?.querySelector(`[data-line="${line}"] span`)?.firstChild;
  assert.ok(text, `line ${line} is drawn`);
  return text;
}

function cardOn(element: Element | undefined): (string | null | undefined)[] {
  assert.ok(element, "the chip is drawn");
  restOn(element);
  const card = document.querySelector(".ui-tooltip-card [data-file-card]");
  assert.ok(card, "the file's card is hung");
  const read = [
    card.querySelector(".ui-hover-card-name")?.textContent,
    card.querySelector(".ui-hover-card-note")?.textContent,
  ];
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return read;
}

function mentionSelected(from: Node, fromOffset: number, to: Node, toOffset: number): boolean {
  const range = document.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  const held: Selection = Object.create(Selection.prototype, {
    isCollapsed: { value: false },
    rangeCount: { value: 1 },
    getComposedRanges: { value: () => [range] },
  });
  const read = vi
    .spyOn(document, "getSelection")
    .mockReturnValueOnce(held)
    .mockReturnValueOnce(held);
  try {
    return runAppCommand(APP_COMMAND.MENTION_LINES);
  } finally {
    read.mockRestore();
  }
}

test("lines picked by their numbers in a File tab, ⌥⌘K, are a chip in the agent's box naming the file and its lines, sent as the lines' address at the commit they were read at", async () => {
  const { container, sent } = await page();

  pressLineNumber(container, 2);
  pressLineNumber(container, 3, true);
  const ran = runAppCommand(APP_COMMAND.MENTION_LINES);
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  const card = cardOn(chips[0]);
  pressInComposer(container, "Enter");
  await settle();

  assert.equal(ran, true);
  assert.deepEqual(card, ["src/invite.ts", "Lines 2–3 at 0123456"]);
  assert.deepEqual(
    chips.map((chip) => chip.querySelector(".ui-inline-ref-label")?.textContent),
    ["invite.ts:2–3"],
  );
  assert.deepEqual(sent, [
    `[@invite.ts:2–3](https://github.com/acme/relay/blob/${HEAD}/src/invite.ts#L2-L3)`,
  ]);
});

test("lines selected as text, a selection that ends where the next line begins, as a line selected whole does, pin that line alone", async () => {
  const { container, sent } = await page();

  mentionSelected(lineText(container, 2), 0, lineText(container, 3), 0);
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(sent, [
    `[@invite.ts:2](https://github.com/acme/relay/blob/${HEAD}/src/invite.ts#L2)`,
  ]);
});

test("with no agent's box on the page, ⌥⌘K is not offered, so the key is left to whatever else wants it", async () => {
  const { container } = await page({ box: false });

  assert.equal(mentionSelected(lineText(container, 2), 1, lineText(container, 3), 2), false);
});
