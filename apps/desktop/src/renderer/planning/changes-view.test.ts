// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CHANGES_UNAVAILABLE,
  type CodingAgentChangedFile,
  PATCH_OMITTED,
} from "@sidecar/hosted/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { FileTreeProps } from "../file-tree/contract";
import { CHANGES_WORDS } from "./changes-model";
import { ChangesView } from "./changes-view";
import { useAgentChanges } from "./use-agent-changes";

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const PAGE = "https://github.com/acme/relay/pull/41/files";

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
  additions: 1,
  deletions: 1,
  patch: "@@ -7,2 +7,2 @@ export function invite() {\n-send(team);\n+sendAll(team);\n }",
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

function changed(
  files: readonly CodingAgentChangedFile[],
  truncated = false,
): CodingAgentChangesAnswerView {
  return { changes: { files, truncated, readAt: 1_800_000_000_000 } };
}

const roots: Root[] = [];

beforeEach(() => {
  tree.props = undefined;
  tree.asked = [];
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The tab as the panel draws it, fed by the hook over a service whose every read is held until the test answers it. */
function mount() {
  const reads: ((answer: CodingAgentChangesAnswerView) => void)[] = [];
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function Tab({ ended }: { ended: boolean }) {
    const control = useAgentChanges({
      agentId: AGENT,
      shown: true,
      ended,
      read: () => new Promise((resolve) => reads.push(resolve)),
    });
    return createElement(ChangesView, {
      read: control.read,
      refreshing: control.refreshing,
      onRefresh: control.onRefresh,
      pageUrl: PAGE,
      openGitHub: (url: string) => opened.push(url),
    });
  }
  const settle = () =>
    act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  const draw = async (ended = false) => {
    act(() => root.render(createElement(Tab, { ended })));
    await settle();
  };
  const answer = async (view: CodingAgentChangesAnswerView) => {
    const read = reads.shift();
    assert.ok(read, "no read is out");
    act(() => read(view));
    await settle();
  };
  const press = async (label: string) => {
    const button = container.querySelector(`button[aria-label="${label}"]`);
    assert.ok(button instanceof HTMLElement, `no ${label} button`);
    act(() => button.click());
    await settle();
  };
  const text = () => container.textContent ?? "";
  /** Each diff row as the pane draws it: its old number, its new number, and its text. */
  const rows = () =>
    [...container.querySelectorAll(".diff-line")].map((row) =>
      [...row.children].map((cell) => cell.textContent).join("|"),
    );
  return { container, reads, opened, draw, answer, press, text, rows };
}

test("the tab reads as it shows and draws the first file's diff, each row numbered on its side, beside the tree of every changed file", async () => {
  const tab = mount();
  await tab.draw();
  assert.equal(tab.reads.length, 1);
  assert.equal(tab.rows().length, 0);

  await tab.answer(changed([INVITE, LOGO]));

  assert.match(tab.text(), /2 files/);
  assert.match(tab.text(), /export function invite\(\) \{/);
  assert.deepEqual(tab.rows(), ["7||send(team);", "|7|sendAll(team);", "8|8|}"]);
  assert.deepEqual(tree.asked, ["only src/invite.ts, public/logo.png", "reveal src/invite.ts"]);
  assert.equal(await tree.props?.readFolder(""), await tree.props?.readFolder("src"));

  await tab.press("Open on GitHub");
  assert.deepEqual(tab.opened, [PAGE]);
});

test("choosing a binary file or one too large to show says so in the diff's place rather than drawing it as unchanged", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer(changed([INVITE, LOGO, LOCKFILE], true));
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.TRUNCATED));

  act(() => tree.props?.onOpen(LOGO.path, false));
  assert.deepEqual(tab.rows(), []);
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.OMITTED[PATCH_OMITTED.BINARY]));
  assert.equal(tree.asked.at(-1), `reveal ${LOGO.path}`);

  act(() => tree.props?.onOpen(LOCKFILE.path, false));
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.OMITTED[PATCH_OMITTED.TOO_LARGE]));
  assert.match(tab.text(), /\+4000/);
});

test("a read that failed offers a retry, which reads again and draws what lands", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.FAILED));

  const retry = [...tab.container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Retry"),
  );
  assert.ok(retry);
  act(() => retry.click());
  assert.equal(tab.reads.length, 1);
  assert.doesNotMatch(tab.text(), new RegExp(CHANGES_WORDS.FAILED));

  await tab.answer(changed([INVITE]));
  assert.match(tab.text(), /1 file/);
});

test("no pull request yet and a pull request with no files each say so, and are not drawn as a failure", async () => {
  const tab = mount();
  await tab.draw();
  await tab.answer({ unavailable: CHANGES_UNAVAILABLE.NO_PULL_REQUEST });
  assert.match(
    tab.text(),
    new RegExp(CHANGES_WORDS.UNAVAILABLE[CHANGES_UNAVAILABLE.NO_PULL_REQUEST].slice(0, 20)),
  );
  assert.doesNotMatch(tab.text(), /Retry/);

  // The agent ending reads again, since that is when what it published settles.
  await tab.draw(true);
  await tab.answer(changed([]));
  assert.match(tab.text(), new RegExp(CHANGES_WORDS.EMPTY));
});

test("a refresh keeps the files drawn until its answer lands, then draws the new change set", async () => {
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
