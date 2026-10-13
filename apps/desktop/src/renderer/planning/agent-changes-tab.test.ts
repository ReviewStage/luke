// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CODING_AGENT_STATUS,
  type CodingAgentChangedFile,
  type CodingAgentStatus,
  type CodingAgentSummary,
  PATCH_OMITTED,
} from "@sidecar/hosted/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND } from "#shared/messages/acts";
import { installActBridge } from "#testing/act-bridge";
import { selectedText, sheetStyle } from "#testing/css-rules";
import { codingAgentsControl } from "#testing/plans-control";
import type { FileTreeProps } from "../file-tree/contract";
import { AgentChangesTab } from "./agent-changes-tab";
import { CHANGES_WORDS } from "./changes-model";

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};
const PULL_REQUEST = "https://github.com/acme/relay/pull/41";

/** What the tree bundle was handed and asked, as a stand-in for the bundle the window loads. */
interface TreeSeen {
  props: FileTreeProps | undefined;
  asked: string[];
}

const tree: TreeSeen = { props: undefined, asked: [] };

// The bundle already loaded, as it is once a tree has been shown in this window.
window.lukeFileTree = {
  mount: (_host, props) => {
    tree.props = props;
    return {
      reveal: (path) => tree.asked.push(`reveal ${path}`),
      search: () => undefined,
      only: (paths) => tree.asked.push(`only ${paths?.join(", ") ?? "all"}`),
      within: () => undefined,
      unmount: () => undefined,
    };
  },
  fileIcon: () => ({ symbol: "file-tree-builtin-default", type: "default" }),
};

const INVITE: CodingAgentChangedFile = {
  path: "src/invite.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  patch: [
    "@@ -7,2 +7,3 @@ export function invite() {",
    "-send(team);",
    "+if (team.open) {",
    "+  sendAll(team);",
    " }",
    "\\ No newline at end of file",
    "@@ -40 +41,2 @@",
    " return;",
    "+--done;",
  ].join("\n"),
  omitted: null,
};

const LOGO: CodingAgentChangedFile = {
  path: "public/logo.png",
  previousPath: null,
  status: CHANGED_FILE_STATUS.ADDED,
  additions: 0,
  deletions: 0,
  patch: null,
  omitted: PATCH_OMITTED.BINARY,
};

const LOCKFILE: CodingAgentChangedFile = {
  path: "pnpm-lock.yaml",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 4000,
  deletions: 3000,
  patch: null,
  omitted: PATCH_OMITTED.TOO_LARGE,
};

const MOVED: CodingAgentChangedFile = {
  path: "src/invites/send.ts",
  previousPath: "src/send.ts",
  status: CHANGED_FILE_STATUS.RENAMED,
  additions: 0,
  deletions: 0,
  patch: "",
  omitted: null,
};

function changed(
  files: readonly CodingAgentChangedFile[],
  truncated = false,
): CodingAgentChangesAnswerView {
  return { pullRequest: { url: PULL_REQUEST, files, truncated } };
}

const roots: Root[] = [];

beforeEach(() => {
  tree.props = undefined;
  tree.asked = [];
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  delete document.documentElement.dataset.keyboard;
  document.body.innerHTML = "";
});

/** The tab as the panel draws it, over a service whose every read is held until the test answers it. */
function mount() {
  const reads: ((answer: CodingAgentChangesAnswerView) => void)[] = [];
  const sent = installActBridge();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = codingAgentsControl({
    readChanges: () => new Promise((resolve) => reads.push(resolve)),
  });
  const settle = () =>
    act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  const draw = async (status: CodingAgentStatus = CODING_AGENT_STATUS.RUNNING) => {
    const agents = [{ ...AGENT, status }];
    act(() =>
      root.render(
        createElement(AgentChangesTab, {
          agentId: AGENT.id,
          control: { ...control, agents },
          shown: true,
        }),
      ),
    );
    await settle();
  };
  const answer = async (view: CodingAgentChangesAnswerView) => {
    const read = reads.shift();
    assert.ok(read, "no read is out");
    act(() => read(view));
    await settle();
  };
  const press = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (each) => each.getAttribute("aria-label") === label || each.textContent?.includes(label),
    );
    assert.ok(button, `no ${label} button`);
    act(() => button.click());
    await settle();
  };
  const text = () => container.textContent ?? "";
  /** Each hunk header and diff row as the pane draws it: its old number, its new number, and its text. */
  const rows = () =>
    [...container.querySelectorAll(".diff-hunk-header, .diff-line")].map((row) =>
      [...row.children].map((cell) => cell.textContent).join("|"),
    );
  return { container, reads, sent, draw, answer, press, text, rows };
}

test("the tab reads as it shows and draws the first file's hunks, each row numbered on its side, beside the tree of every changed file", async () => {
  const tab = mount();
  await tab.draw();
  assert.equal(tab.reads.length, 1);
  assert.deepEqual(tab.rows(), []);

  await tab.answer(changed([INVITE, LOGO]));

  assert.match(tab.text(), /2 files/);
  assert.deepEqual(tab.rows(), [
    "||@@ -7,2 +7,3 @@ export function invite() {",
    "7||send(team);",
    "|7|if (team.open) {",
    "|8|  sendAll(team);",
    "8|9|}",
    "||No newline at end of file",
    "||@@ -40 +41,2 @@",
    "40|41|return;",
    "|42|--done;",
  ]);
  assert.deepEqual(tree.asked, ["only src/invite.ts, public/logo.png", "reveal src/invite.ts"]);
  assert.equal(await tree.props?.readFolder(""), await tree.props?.readFolder("src"));

  await tab.press("Open on GitHub");
  assert.deepEqual(tab.sent.at(-1), {
    kind: ACT_KIND.GITHUB_OPEN,
    payload: { url: `${PULL_REQUEST}/files` },
  });
});

test("the tree of changed files rings its focused row in the window's ring, drawn inside the row, and in no colour until the keyboard has moved focus", async () => {
  const style = await sheetStyle();
  const tab = mount();
  await tab.draw();
  await tab.answer(changed([INVITE, LOGO]));
  const host = tab.container.querySelector<HTMLElement>(".file-tree-host");
  assert.ok(host, "the tab draws the tree");
  // Pierre's shadow root reads these from the host it stands in.
  const ring = () =>
    ["color", "width", "offset"].map((part) => style(host, `--trees-focus-ring-${part}-override`));

  assert.deepEqual(ring(), [
    "transparent",
    "var(--focus-ring-width)",
    "calc(var(--focus-ring-width) * -1)",
  ]);
  document.documentElement.dataset.keyboard = "true";
  assert.deepEqual(ring(), [
    "var(--focus-ring)",
    "var(--focus-ring-width)",
    "calc(var(--focus-ring-width) * -1)",
  ]);
});

test("a diff's lines select and copy as text, both gutters' numbers left out and a blank line kept as one", async () => {
  const style = await sheetStyle();
  const tab = mount();
  await tab.draw();
  await tab.answer(changed([{ ...INVITE, patch: "@@ -1,2 +1,3 @@\n a();\n+\n b();" }]));

  const lines = [...tab.container.querySelectorAll(".diff-line")];
  // Note that each line leaves text in the copy, because a line that leaves
  // none is closed up by the browser's copy.
  assert.deepEqual(
    lines.map((line) => selectedText(style, line)),
    ["a();", "\n", "b();"],
  );
});

test("choosing a binary file, one too large to show, or one only moved says so in the diff's place rather than drawing it as unchanged", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer(changed([INVITE, LOGO, LOCKFILE, MOVED], true));
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.TRUNCATED));

  act(() => tree.props?.onOpen(LOGO.path, false));
  assert.deepEqual(tab.rows(), []);
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.OMITTED[PATCH_OMITTED.BINARY]));
  assert.equal(tree.asked.at(-1), `reveal ${LOGO.path}`);

  act(() => tree.props?.onOpen(LOCKFILE.path, false));
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.OMITTED[PATCH_OMITTED.TOO_LARGE]));
  assert.match(tab.text(), /\+4000/);

  act(() => tree.props?.onOpen(MOVED.path, false));
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.UNCHANGED_CONTENTS));
  assert.match(tab.text(), /src\/send\.ts → src\/invites\/send\.ts/);
});

test("a patch that does not read as a diff says so rather than drawing nothing", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer(changed([{ ...INVITE, patch: "@@ -1,2 +1,2 @@\n+one" }]));
  assert.deepEqual(tab.rows(), []);
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.UNREADABLE));
});

test("a read that failed offers a retry, which shows the wait and draws what lands", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.FAILED));

  await tab.press("Retry");
  assert.equal(tab.reads.length, 1);
  assert.doesNotMatch(tab.text(), new RegExp(CHANGES_WORDS.FAILED));

  await tab.answer(changed([INVITE]));
  assert.match(tab.text(), /1 file/);
});

test("no pull request yet and a pull request with no files each say so, not as a failure, and the agent ending reads again", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer({ pullRequest: null });
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.NO_PULL_REQUEST));
  assert.doesNotMatch(tab.text(), /Retry/);

  await tab.draw();
  assert.equal(tab.reads.length, 0, "a draw while the agent still runs asks nothing");
  await tab.draw(CODING_AGENT_STATUS.COMPLETED);
  await tab.answer(changed([]));
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.EMPTY));
});

test("a refresh keeps the files drawn until its answer lands, then draws the new list", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer(changed([INVITE]));

  await tab.press("Refresh changes");
  assert.equal(tab.reads.length, 1);
  assert.match(tab.text(), /1 file/);

  await tab.answer(changed([INVITE, LOGO]));
  assert.match(tab.text(), /2 files/);
  assert.equal(tree.asked.at(-1), "only src/invite.ts, public/logo.png");
});
