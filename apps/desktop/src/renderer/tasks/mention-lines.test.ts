// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAgentAnswer } from "@luke/features/coding-agent-view";
import type { TasksFileAnswer } from "@luke/features/tasks-view";
import { ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { runAppCommand } from "@luke/panel/app-commands";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
} from "#testing/composer";
import { AgentComposer } from "./agent-composer";
import { FileTab } from "./file-tab";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions";
import { type MessageSender, useAgentComposer } from "./use-agent-composer";

/**
 * A File tab's lines mentioned in the agent's message box on the same task's
 * page, over the real editor bundle: the lines selected in the tab, the
 * command ⌥⌘K runs, and the box holding the mention as its chip, pinned to
 * the commit the lines were read at, sent as the lines' GitHub address.
 * Synthetic plan and repository.
 */

const TASK_ID = "pl_1";

/** The commit the default branch's head stood at when the lines were read. */
const HEAD = "0123456789abcdef0123456789abcdef01234567";

const ignore = () => undefined;

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({
    act: (_request: Act): Promise<ActOutcome> =>
      Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
  });
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
  taskId: TASK_ID,
  taskName: "Invitations",
  workspace: "acme",
  repository: "acme/relay",
  text: () => "## Goal\n\nInvite by email.\n",
  doors: {
    taskId: TASK_ID,
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(["goal"]),
    onOpenTask: ignore,
    onOpenFile: undefined,
  },
};

/** The file as the service read it at the head's commit. */
const readFile = (): Promise<TasksFileAnswer> =>
  Promise.resolve({
    file: {
      path: "src/invite.ts",
      repository: "acme/relay",
      branch: "main",
      commit: HEAD,
      firstLine: 1,
      lineCount: 4,
      lines: [[{ text: "one" }], [{ text: "two" }], [{ text: "three" }], [{ text: "four" }]],
    },
  });

/** The agent's box on the composer's own control, its sends answered by `sender`. */
function Box({ sender }: { sender: MessageSender }): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: TASK_ID,
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(AgentComposer, {
    ...QUIET_COMPOSER,
    composer,
    skills: () => Promise.resolve({ skills: [] }),
  });
}

/** A task's page drawing the file's tab and, unless it is asked not to, the agent's box, every message the box sends written down. */
async function page({ box = true }: { box?: boolean } = {}) {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise<CodingAgentAgentAnswer>(ignore);
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(TaskMentions, {
        value: PAGE,
        children: [
          createElement(FileTab, {
            key: "file",
            file: { path: "src/invite.ts", range: undefined, opened: 1 },
            snippet: undefined,
            notes: { notes: [], folded: [], onFold: ignore, onShow: ignore },
            readFile,
            onRead: ignore,
          }),
          box ? createElement(Box, { key: "box", sender }) : null,
        ],
      }),
    ),
  );
  await settle();
  return { container, sent };
}

/** The text of a line the tab draws, by its number. */
function lineText(container: HTMLElement, line: number): Node {
  const row = [...container.querySelectorAll(".file-tab .code-line")].find(
    (each) => each.querySelector(".code-line-number")?.textContent === String(line),
  );
  const text = row?.querySelector(".code-line-text")?.firstChild?.firstChild;
  assert.ok(text, `line ${line} is drawn`);
  return text;
}

/** The file's card hung while the pointer rests on `element`: its name and its note. */
function cardOn(element: Element | undefined): (string | null | undefined)[] {
  assert.ok(element, "the chip is drawn");
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-file-card]");
  assert.ok(card, "the file's card is hung");
  const read = [
    card.querySelector(".luke-hover-card-name")?.textContent,
    card.querySelector(".luke-hover-card-note")?.textContent,
  ];
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return read;
}

/** A selection from a place in one line's text to a place in another's. */
function select(from: Node, fromOffset: number, to: Node, toOffset: number): void {
  const range = document.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

test("lines selected in a File tab, ⌥⌘K, are a chip in the agent's box naming the file and its lines, sent as the lines' address at the commit they were read at", async () => {
  const { container, sent } = await page();

  select(lineText(container, 2), 1, lineText(container, 3), 2);
  const ran = runAppCommand(APP_COMMAND.MENTION_LINES);
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  const card = cardOn(chips[0]);
  pressInComposer(container, "Enter");
  await settle();

  assert.equal(ran, true);
  assert.deepEqual(card, ["src/invite.ts", "Lines 2–3 at 0123456"]);
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["invite.ts:2–3"],
  );
  assert.deepEqual(sent, [
    `[@invite.ts:2–3](https://github.com/acme/relay/blob/${HEAD}/src/invite.ts#L2-L3)`,
  ]);
});

test("a selection that ends where the next line begins, as a line selected whole does, pins that line alone", async () => {
  const { container, sent } = await page();

  select(lineText(container, 2), 0, lineText(container, 3), 0);
  runAppCommand(APP_COMMAND.MENTION_LINES);
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(sent, [
    `[@invite.ts:2](https://github.com/acme/relay/blob/${HEAD}/src/invite.ts#L2)`,
  ]);
});

test("with no agent's box on the page, ⌥⌘K is not offered, so the key is left to whatever else wants it", async () => {
  const { container } = await page({ box: false });

  select(lineText(container, 2), 1, lineText(container, 3), 2);

  assert.equal(runAppCommand(APP_COMMAND.MENTION_LINES), false);
});
