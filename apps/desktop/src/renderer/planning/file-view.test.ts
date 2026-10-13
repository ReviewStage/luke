// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  PLAN_FILE_REFUSAL,
  PLAN_TREE_ENTRY,
  type PlanFileRequest,
} from "@sidecar/hosted/plan-wire";
import type { PlanCode, PlanCodeShowing, PlanningTreeAnswer } from "@sidecar/hosted/planning-view";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { finishAll, installAnimations, MOTION, motion, running } from "#testing/animations";
import { installClipboard, onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { sheetStyle } from "#testing/css-rules";
import { installHighlights } from "#testing/find-highlights";
import { useAppKeymap } from "../app-commands";
import type { FileTreeProps } from "../file-tree/contract";
import { FindScope } from "../find-in-tab";
import { ToastHost } from "../toast";
import type { ReadFileWindow } from "./file-tab";
import { FileView } from "./file-view";
import { FILE_HISTORY_STEP, type OpenFile } from "./use-side-panel";

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const REPOSITORY = "acme/relay";
const FILE = "apps/web/server/plans-app.ts";

/** What the tree bundle was handed and asked, as a stand-in for the bundle the window loads. */
interface TreeSeen {
  props: FileTreeProps | undefined;
  reveals: string[];
  /** Each search the tree was asked for, and each narrowing, the whole repository written as "all". */
  narrowed: string[];
}

const tree: TreeSeen = { props: undefined, reveals: [], narrowed: [] };

// The bundle already loaded, as it is once a tree has been shown in this window.
window.lukeFileTree = {
  mount: (_host, props) => {
    tree.props = props;
    return {
      reveal: (path, options) => tree.reveals.push(`${path}${options.focus ? " focused" : ""}`),
      search: (query) => tree.narrowed.push(`search "${query}"`),
      only: (paths) => tree.narrowed.push(`only ${paths?.join(", ") ?? "all"}`),
      within: (entries) =>
        tree.narrowed.push(
          `within ${entries.map((entry) => `${entry.name}${entry.folder ? "/" : ""}`).join(", ")}`,
        ),
      unmount: () => undefined,
    };
  },
  fileIcon: () => ({ symbol: "file-tree-builtin-default", type: "default" }),
};

const roots: Root[] = [];

beforeEach(() => {
  installAnimations();
  tree.props = undefined;
  tree.reveals = [];
  tree.narrowed = [];
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  running.splice(0);
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

/** Each folder's listing as the service answers it, by path. */
const FOLDERS = new Map<string, PlanningTreeAnswer>([
  [
    "apps/web",
    {
      folder: {
        path: "apps/web",
        repository: REPOSITORY,
        branch: "main",
        entries: [
          { name: "server", kind: PLAN_TREE_ENTRY.FOLDER },
          { name: "README.md", kind: PLAN_TREE_ENTRY.FILE },
          { name: "package.json", kind: PLAN_TREE_ENTRY.FILE },
          { name: "lib", kind: PLAN_TREE_ENTRY.FOLDER },
        ],
        truncated: false,
      },
    },
  ],
  ["", { refusal: PLAN_FILE_REFUSAL.NOT_REACHABLE }],
  ["flaky", { refusal: PLAN_FILE_REFUSAL.UNAVAILABLE }],
]);

/** The whole repository listed in one read, as the search asks it, or cut short. */
function wholeListing(truncated: boolean): PlanningTreeAnswer {
  return {
    folder: {
      path: "",
      repository: REPOSITORY,
      branch: "main",
      entries: [
        { name: "apps", kind: PLAN_TREE_ENTRY.FOLDER },
        { name: FILE, kind: PLAN_TREE_ENTRY.FILE },
      ],
      truncated,
    },
  };
}

/** A code Luke showed on the plan, of the file and repository given. */
function showing(path: string, repository: string): PlanCodeShowing {
  return {
    callId: `call-${path}`,
    turnId: "turn-1",
    shownAt: 0,
    code: { ref: { path }, repository, firstLine: 1, lineCount: 1, lines: [[]] },
  };
}

/** A range of `FILE` Luke showed by the call given, with his note where given, of the plan's repository unless another is named. */
function shownLines(
  callId: string,
  startLine: number,
  endLine: number,
  note: string | undefined,
  repository = REPOSITORY,
  commit?: string,
): PlanCodeShowing {
  return {
    callId,
    turnId: "turn-1",
    shownAt: 0,
    code: {
      ref: { path: FILE, startLine, endLine },
      repository,
      ...(commit === undefined ? undefined : { commit }),
      firstLine: 1,
      lineCount: 40,
      lines: [[]],
      ...(note === undefined ? undefined : { note }),
    },
  };
}

/** Each note card drawn, as a reader meets it: its name, then the number of the line it stands over. */
function noteCards(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(".file-note")].map((card) => {
    const line = card.nextElementSibling?.querySelector(".code-line-number")?.textContent;
    return `${card.getAttribute("aria-label")} over ${line}`;
  });
}

/** A file of `lineCount` lines read a window at a time, each line saying its own number. */
function numberedFile(lineCount: number): ReadFileWindow {
  return (window) => {
    if (window.raw === true) {
      const text = Array.from({ length: lineCount }, (_, at) => `line ${at + 1}`).join("\n");
      return Promise.resolve({
        text: { path: window.path, repository: REPOSITORY, branch: "release/2026", text },
      });
    }
    const last = Math.min(window.lastLine, lineCount);
    return Promise.resolve({
      file: {
        path: window.path,
        repository: REPOSITORY,
        branch: "release/2026",
        firstLine: window.firstLine,
        lineCount,
        lines: Array.from({ length: Math.max(0, last - window.firstLine + 1) }, (_, at) => [
          { text: `line ${window.firstLine + at}` },
        ]),
      },
    });
  };
}

/**
 * The view over a file, its tree closed, every folder listed, every file
 * browsed to, and every page opened on GitHub written down. The file browsed
 * to is shown in the view, and the view's history walks them as the panel's
 * does.
 */
function mounted(
  shownCode: readonly PlanCodeShowing[] = [],
  whole: () => Promise<PlanningTreeAnswer> = () => Promise.resolve(wholeListing(false)),
  readFile: ReadFileWindow = numberedFile(1),
  registry?: AtomRegistry.AtomRegistry,
  snippet?: PlanCode,
) {
  const listed: string[] = [];
  const browsed: string[] = [];
  const github: string[] = [];
  const notesShown: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function View({ start }: { start: OpenFile }) {
    const [treeOpen, setTreeOpen] = useState(false);
    const [walk, setWalk] = useState({ files: [start], at: 0 });
    // The file first drawn follows the draw until the view walks away from it, as the panel's tab does when opened again.
    const walked = walk.files.length === 1 ? start : (walk.files[walk.at] ?? start);
    // The tab keeps what it folded, as the panel's record of it does.
    const [folded, setFolded] = useState<readonly string[]>([]);
    const file = { ...walked, foldedNotes: folded };
    useAppKeymap(true);
    const view = createElement(FileView, {
      planId: PLAN,
      repository: REPOSITORY,
      file,
      snippet,
      shownCode,
      readFile,
      readFolder: (path) => {
        listed.push(path);
        return Promise.resolve(FOLDERS.get(path) ?? { failure: "unanswered" as const });
      },
      readWhole: whole,
      openGitHub: (url) => github.push(url),
      treeOpen,
      onToggleTree: () => setTreeOpen((was) => !was),
      onBrowse: (path, newTab) => {
        browsed.push(newTab ? `${path} in a new tab` : path);
        if (newTab) return;
        setWalk(({ files, at }) => ({
          files: [...files.slice(0, at + 1), { path, range: undefined, opened: 1 }],
          at: at + 1,
        }));
      },
      history: {
        canGoBack: walk.at > 0,
        canGoForward: walk.at < walk.files.length - 1,
        onStep: (step) =>
          setWalk(({ files, at }) => ({
            files,
            at: step === FILE_HISTORY_STEP.BACK ? at - 1 : at + 1,
          })),
      },
      onFoldNote: (callId, fold) =>
        setFolded((was) => [...was.filter((call) => call !== callId), ...(fold ? [callId] : [])]),
      onShowNote: (callId) => notesShown.push(callId),
    });
    // The view stands in the side panel's find, as it does in the window.
    return createElement(
      FindScope,
      { active: true, subject: { plan: PLAN, tab: { file: file.path } } },
      view,
    );
  }
  const draw = async (path: string, range?: OpenFile["range"], opened = 1, commit?: string) => {
    await act(async () => {
      const start = { path, range, opened, ...(commit === undefined ? undefined : { commit }) };
      const view = createElement(View, { key: path, start });
      root.render(registry === undefined ? view : onRegistry(registry, view));
      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
    });
  };
  const press = async (element: Element | null | undefined) => {
    assert.ok(element instanceof HTMLElement, "nothing to press");
    await act(async () => {
      element.click();
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  };
  // Lets the reads a change asked for land and their drawing settle.
  const settle = () =>
    act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`.file-view-bar button[aria-label="${label}"]`);
  return { container, listed, browsed, github, notesShown, draw, press, settle, button };
}

/** The bar's crumbs, as they read. */
function crumbsOf(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(".file-breadcrumb")].map(
    (crumb) => crumb.textContent ?? "",
  );
}

test("one bar spans the file and its tree: Back and Forward, the path, then GitHub, the file's actions, and the tree's toggle, which shows the tree under the bar", async () => {
  const view = mounted();
  await view.draw(FILE);

  const bar = view.container.querySelector(".file-view-bar");
  assert.deepEqual(
    [...(bar?.querySelectorAll("button[aria-label]") ?? [])].map((button) =>
      button.getAttribute("aria-label"),
    ),
    ["Back", "Forward", "Open on GitHub", "File actions", "Show files"],
  );
  assert.equal(
    view.container.querySelector(".file-view-commit"),
    null,
    "no commit pins a read of main",
  );
  assert.equal(view.container.querySelector(".file-tree-pane"), null, "the tree starts closed");
  await view.press(view.button("Show files"));
  assert.equal(view.button("Hide files")?.getAttribute("aria-expanded"), "true");
  assert.ok(view.container.querySelector(".file-view-body > .file-tree-pane"));
  assert.equal(
    document.querySelectorAll(".file-view-bar").length,
    1,
    "the tree has no bar of its own",
  );
});

/** The keyframes of the slide running on the tree's pane, as transforms; none while none runs. */
function treeSlide(container: HTMLElement): readonly (string | undefined)[] | undefined {
  const pane = container.querySelector(".file-tree-pane");
  const slide = running.find((each) => each.element === pane);
  return slide?.keyframes.map((frame) => frame.transform?.toString());
}

test("the tree slides in from the view's right edge on the pane's motion, and hidden it leaves the layout at once, sliding out over the file out of reach until the slide has played", async () => {
  motion(MOTION.ON);
  const view = mounted();
  await view.draw(FILE);

  await view.press(view.button("Show files"));
  assert.deepEqual(treeSlide(view.container), ["translateX(100%)", "none"]);
  finishAll();

  await view.press(view.button("Hide files"));
  const leaving = view.container.querySelector<HTMLElement>(".file-tree-pane");
  assert.ok(leaving, "the tree is held drawn through its slide out");
  assert.equal(
    leaving.hasAttribute("data-leaving"),
    true,
    "drawn over the file, out of the layout",
  );
  assert.equal(leaving.hasAttribute("inert"), true, "and out of reach");
  assert.deepEqual(treeSlide(view.container), ["none", "translateX(100%)"]);
  finishAll();
  assert.equal(
    view.container.querySelector(".file-tree-pane"),
    null,
    "let go once it has slid out",
  );
});

test("a tree shown again part way through its slide out comes back from where it had got to, and stays", async () => {
  motion(MOTION.ON);
  const view = mounted();
  await view.draw(FILE);
  await view.press(view.button("Show files"));
  finishAll();
  await view.press(view.button("Hide files"));
  const pane = view.container.querySelector<HTMLElement>(".file-tree-pane");
  assert.ok(pane);
  // Note that jsdom computes no animation, so the slide's reach is stood in for on the pane itself.
  pane.style.transform = "translateX(40px)";

  await view.press(view.button("Show files"));
  assert.equal(
    view.container.querySelector(".file-tree-pane"),
    pane,
    "the same pane, never drawn anew",
  );
  assert.equal(pane.hasAttribute("data-leaving"), false);
  assert.deepEqual(treeSlide(view.container), ["translateX(40px)", "none"]);
  finishAll();
  assert.ok(view.container.querySelector(".file-tree-pane"), "the tree stands");
});

test("a tree shown again once motion was reduced part way through its slide out stands in place, the slide stopped", async () => {
  motion(MOTION.ON);
  const view = mounted();
  await view.draw(FILE);
  await view.press(view.button("Show files"));
  finishAll();
  await view.press(view.button("Hide files"));
  assert.notEqual(treeSlide(view.container), undefined, "sliding out");

  motion(MOTION.REDUCED);
  await view.press(view.button("Show files"));
  const pane = view.container.querySelector(".file-tree-pane");
  assert.ok(pane);
  assert.equal(pane.hasAttribute("data-leaving"), false);
  assert.equal(treeSlide(view.container), undefined, "no slide left holding it past the edge");
});

test("under reduced motion the tree shows and hides at once, with nothing played", async () => {
  motion(MOTION.REDUCED);
  const view = mounted();
  await view.draw(FILE);
  await view.press(view.button("Show files"));
  assert.ok(view.container.querySelector(".file-tree-pane"));
  await view.press(view.button("Hide files"));
  assert.equal(view.container.querySelector(".file-tree-pane"), null);
  assert.deepEqual(running, []);
});

test("the crumbs are in the window's own type, as a tab's name is, while the file's lines stay in code type", async () => {
  const style = await sheetStyle();
  const view = mounted();
  await view.draw(FILE);
  const crumbs = [...view.container.querySelectorAll(".file-breadcrumb")];
  assert.ok(crumbs.length > 0);
  for (const crumb of crumbs) {
    assert.doesNotMatch(style(crumb, "font-family") ?? "", /monospace/u);
  }
  const line = view.container.querySelector(".code-lines");
  assert.ok(line);
  assert.match(style(line, "font-family") ?? "", /monospace/u);
});

test("each crumb hangs the tree over the folder it stands in, through the view's listings, the tab's file revealed and taking the keyboard; the chevrons between are no controls; a file the tree opens is browsed to from the repository's root, and takes the tree down", async () => {
  const view = mounted();
  await view.draw("apps/web/README.md");
  assert.deepEqual(crumbsOf(view.container), [REPOSITORY, "apps", "web", "README.md"]);
  assert.equal(view.container.querySelectorAll(".file-breadcrumbs button").length, 4);
  assert.ok(
    [...view.container.querySelectorAll(".file-breadcrumb-separator")].every(
      (separator) =>
        separator.getAttribute("aria-hidden") === "true" && !separator.querySelector("button"),
    ),
  );
  await view.press(view.button("Show files"));
  const pane = tree.props;

  await view.press(view.container.querySelectorAll(".file-breadcrumb")[3]);
  const crumbTree = tree.props;
  assert.ok(crumbTree !== undefined && crumbTree !== pane, "the crumb mounted a tree of its own");
  assert.equal(tree.reveals.at(-1), "README.md focused");
  assert.deepEqual(await pane?.readFolder("apps/web"), await crumbTree.readFolder(""));
  assert.equal(
    view.listed.filter((path) => path === "apps/web").length,
    1,
    "a folder is listed once for the pane and the crumb alike",
  );

  act(() => crumbTree.onOpen("package.json", true));
  assert.equal(document.querySelector(".file-crumb-tree"), null, "a file opened takes it down");
  assert.deepEqual(view.browsed, ["apps/web/package.json in a new tab"]);
});

test("Back and Forward walk the files this tab showed, each dimmed while its way holds none", async () => {
  const view = mounted();
  await view.draw(FILE);
  assert.equal(view.button("Back")?.disabled, true);
  assert.equal(view.button("Forward")?.disabled, true);

  await view.press(view.button("Show files"));
  act(() => tree.props?.onOpen("apps/web/README.md", false));
  await view.settle();
  assert.deepEqual(crumbsOf(view.container).at(-1), "README.md");
  await view.press(view.button("Back"));
  assert.deepEqual(crumbsOf(view.container).at(-1), "plans-app.ts");
  assert.equal(view.button("Back")?.disabled, true);
  await view.press(view.button("Forward"));
  assert.deepEqual(crumbsOf(view.container).at(-1), "README.md");
  assert.equal(view.button("Forward")?.disabled, true);
});

test("the GitHub button opens the file on the branch it was read on, its lit lines marked where it still has them, and is dimmed over a file not read", async () => {
  // The rows reading more of a long file watch for their scroll into view, which jsdom never sees.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const lit = mounted([], undefined, numberedFile(1_200));
  await lit.draw("src/invite #2.ts", { startLine: 600, endLine: 604 });
  await lit.press(lit.button("Open on GitHub"));
  const plain = mounted([], undefined, numberedFile(1_200));
  await plain.draw("src/invite #2.ts");
  await plain.press(plain.button("Open on GitHub"));
  const shortened = mounted([], undefined, numberedFile(20));
  await shortened.draw("src/invite.ts", { startLine: 21, endLine: 22 });
  await shortened.press(shortened.button("Open on GitHub"));

  assert.deepEqual(
    [...lit.github, ...plain.github, ...shortened.github],
    [
      "https://github.com/acme/relay/blob/release/2026/src/invite%20%232.ts#L600-L604",
      "https://github.com/acme/relay/blob/release/2026/src/invite%20%232.ts",
      "https://github.com/acme/relay/blob/release/2026/src/invite.ts",
    ],
  );
  const refused = mounted([], undefined, () =>
    Promise.resolve({ refusal: PLAN_FILE_REFUSAL.MISSING, branch: "main" }),
  );
  await refused.draw("src/moved.ts");
  assert.equal(refused.button("Open on GitHub")?.disabled, true);
});

test("a file opened at a commit is read at it, named quietly in the bar by its short SHA, opened on GitHub there, and said missing there in the commit's words; opened at another commit it is read afresh, no line of the first kept", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const first = "0123456789abcdef0123456789abcdef01234567";
  const second = "89abcdef0123456789abcdef0123456789abcdef";
  const asked: PlanFileRequest[] = [];
  const readFile: ReadFileWindow = (window) => {
    asked.push(window);
    const at = window.ref ?? "main";
    if (window.raw === true) {
      return Promise.resolve({
        text: { path: window.path, repository: REPOSITORY, branch: at, text: "x" },
      });
    }
    return Promise.resolve({
      file: {
        path: window.path,
        repository: REPOSITORY,
        branch: at,
        firstLine: 1,
        lineCount: 2,
        lines: [[{ text: `${at} one` }], [{ text: `${at} two` }]],
      },
    });
  };
  const view = mounted([], undefined, readFile);
  await view.draw(FILE, { startLine: 2, endLine: 2 }, 1, first);
  assert.equal(view.container.querySelector(".file-view-commit")?.textContent, "0123456");
  await view.press(view.button("Open on GitHub"));
  assert.deepEqual(view.github, [
    `https://github.com/acme/relay/blob/${first}/apps/web/server/plans-app.ts#L2`,
  ]);
  assert.deepEqual(
    asked.map((window) => window.ref),
    [first],
  );

  await view.draw(FILE, { startLine: 1, endLine: 1 }, 2, second);
  await view.settle();
  assert.deepEqual(
    asked.map((window) => window.ref),
    [first, second],
  );
  assert.deepEqual(
    [...view.container.querySelectorAll(".code-line-text")].map((line) => line.textContent),
    [`${second} one`, `${second} two`],
  );

  const gone = mounted([], undefined, (window) =>
    Promise.resolve({ refusal: PLAN_FILE_REFUSAL.MISSING, branch: window.ref ?? "main" }),
  );
  await gone.draw("src/moved.ts", undefined, 1, first);
  assert.equal(
    gone.container.querySelector("[role='alert'] p")?.textContent,
    "This file is not at commit 0123456 on GitHub, or the commit was never pushed.",
  );
});

test("the tree hears a folder in the File tab's words, a refusal saying whether listing again may help, and a file it opens is browsed to", async () => {
  const view = mounted();
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));
  const props = tree.props;
  assert.ok(props, "the tree was mounted");

  assert.deepEqual(await props.readFolder(""), {
    notice: "The Luke GitHub App no longer reaches this plan's repository.",
    retry: false,
  });
  assert.deepEqual(await props.readFolder("flaky"), {
    notice: "GitHub could not be read just now.",
    retry: true,
  });
  assert.deepEqual(await props.readFolder("gone"), {
    notice: "The files could not be read.",
    retry: true,
  });
  assert.deepEqual((await props.readFolder("apps/web")).valueOf(), {
    entries: [
      { name: "server", folder: true },
      { name: "README.md", folder: false },
      { name: "package.json", folder: false },
      { name: "lib", folder: true },
    ],
    truncated: false,
  });
  props.onOpen("apps/web/README.md", true);
  assert.deepEqual(view.browsed, ["apps/web/README.md in a new tab"]);
  assert.deepEqual(
    view.listed.filter((path) => path === "flaky"),
    ["flaky"],
  );
  await props.readFolder("flaky");
  assert.deepEqual(
    view.listed.filter((path) => path === "flaky"),
    ["flaky", "flaky"],
    "a refusal is not kept, so the next ask lists again",
  );
});

test("the tree's search hands the tree what is typed, Escape clears it, and ⌘F in the pane takes the caret there; the filter narrows to the files Luke showed of this repository", async () => {
  const view = mounted([
    showing(FILE, REPOSITORY),
    showing("README.md", "acme/other"),
    showing("apps/web/README.md", REPOSITORY),
    showing(FILE, REPOSITORY),
  ]);
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));
  const field = view.container.querySelector<HTMLInputElement>('input[aria-label="Search files"]');
  assert.ok(field, "the tree has a search field");
  tree.narrowed = [];

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const type = (words: string) =>
    act(() => {
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  type("plans");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(field.value, "");
  assert.deepEqual(tree.narrowed, ['search "plans"', 'search ""']);

  const filter = view.container.querySelector('[aria-label="Only files Luke showed"]');
  await view.press(filter);
  assert.equal(filter?.getAttribute("aria-pressed"), "true");
  assert.equal(
    tree.narrowed.findLast((asked) => asked.startsWith("only")),
    `only ${FILE}, apps/web/README.md`,
  );

  const pane = view.container.querySelector(".file-tree-pane");
  act(() => {
    pane?.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
  });
  assert.equal(document.activeElement, field);
  assert.equal(view.container.querySelector(".find-bar"), null, "the tab's find bar stays shut");
});

test("the filter offers nothing while Luke has shown no file of the repository", async () => {
  const view = mounted([showing("README.md", "acme/other")]);
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));

  const filter = view.container.querySelector<HTMLButtonElement>(
    '[aria-label="Only files Luke showed"]',
  );
  assert.equal(filter?.disabled, true);
});

test("the first search reads the whole repository once and hands the tree its every entry; a listing cut short leaves the search on the folders opened, as the empty field says", async () => {
  const typeInto = (field: HTMLInputElement, words: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const fieldOf = (container: HTMLElement) => {
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Search files"]');
    assert.ok(field, "the tree has a search field");
    return field;
  };

  const whole = mounted();
  await whole.draw(FILE);
  await whole.press(whole.container.querySelector(".file-tree-toggle"));
  assert.equal(fieldOf(whole.container).placeholder, "Search files");
  typeInto(fieldOf(whole.container), "plans");
  await whole.draw(FILE);
  typeInto(fieldOf(whole.container), "plans-app");
  await whole.draw(FILE);
  assert.deepEqual(
    tree.narrowed.filter((asked) => asked.startsWith("within")),
    [`within apps/, ${FILE}`],
  );
  act(() => roots.pop()?.unmount());

  tree.narrowed = [];
  const cut = mounted([], () => Promise.resolve(wholeListing(true)));
  await cut.draw(FILE);
  await cut.press(cut.container.querySelector(".file-tree-toggle"));
  typeInto(fieldOf(cut.container), "plans");
  await cut.draw(FILE);
  typeInto(fieldOf(cut.container), "");
  await cut.draw(FILE);
  assert.equal(fieldOf(cut.container).placeholder, "Search opened folders");
  assert.deepEqual(
    tree.narrowed.filter((asked) => asked.startsWith("within")),
    [],
  );
});

test("a whole read that did not land leaves the search on the folders opened without asking again until the field is emptied and a new search begins", async () => {
  let asked = 0;
  const view = mounted([], () => {
    asked += 1;
    return Promise.resolve({ refusal: PLAN_FILE_REFUSAL.UNAVAILABLE });
  });
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));
  const field = view.container.querySelector<HTMLInputElement>('input[aria-label="Search files"]');
  assert.ok(field, "the tree has a search field");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const type = async (words: string) => {
    act(() => {
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await view.draw(FILE);
  };

  await type("plans");
  await type("plans-app");
  assert.equal(asked, 1, "the search standing asks once");
  await type("");
  await type("routes");
  assert.equal(asked, 2, "a new search asks again");
  assert.deepEqual(
    tree.narrowed.filter((narrowing) => narrowing.startsWith("within")),
    [],
  );
});

/** Main's save dialog on the act channel, every file saved written down by its name. */
function installSaveDialog(): string[] {
  const saved: string[] = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind !== ACT_KIND.WINDOW_SAVE_FILE) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
        }
        saved.push(`${request.payload.name}: ${request.payload.text.split("\n").length} lines`);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: true });
      },
    },
  });
  return saved;
}

/** The ⋯'s items as they read, a setting's check marked. */
function menuItems(): readonly string[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].map(
    (item) =>
      `${item.textContent}${item.getAttribute("aria-checked") === "true" ? " ✓" : ""}${item.disabled ? " (dimmed)" : ""}`,
  );
}

/** Chooses the ⋯'s item that reads `label`, opening the menu first. */
async function chooseInMenu(view: ReturnType<typeof mounted>, label: string): Promise<void> {
  await view.press(view.button("File actions"));
  await view.press(
    [...document.querySelectorAll('[role="menu"] button')].find(
      (item) => item.textContent === label,
    ),
  );
}

it.effect(
  "the ⋯ copies the file's name and its whole text, read past the window drawn, saves the file through the save dialog, and offers neither text over a file not read",
  () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      const saved = installSaveDialog();
      const clipboard = installClipboard();
      const registry = yield* registryOnTestClock;
      const view = mounted([], undefined, numberedFile(1_200), registry);
      yield* Effect.promise(() => view.draw("src/invite.ts", { startLine: 4, endLine: 6 }));

      yield* Effect.promise(() => chooseInMenu(view, "Copy file name"));
      yield* Effect.promise(() => chooseInMenu(view, "Copy file contents"));
      yield* Effect.promise(() => view.settle());
      yield* Effect.promise(() => chooseInMenu(view, "Download file"));
      yield* Effect.promise(() => view.settle());

      const [name, text] = clipboard.copied;
      assert.equal(name, "invite.ts");
      assert.equal(text?.split("\n").length, 1_200);
      assert.equal(text?.split("\n").at(-1), "line 1200");
      assert.deepEqual(saved, ["invite.ts: 1200 lines"]);

      const refused = mounted(
        [],
        undefined,
        () => Promise.resolve({ refusal: PLAN_FILE_REFUSAL.MISSING, branch: "main" }),
        registry,
      );
      yield* Effect.promise(() => refused.draw("src/moved.ts"));
      yield* Effect.promise(() => refused.press(refused.button("File actions")));
      assert.deepEqual(menuItems().slice(0, 3), [
        "Copy file name",
        "Copy file contents (dimmed)",
        "Download file (dimmed)",
      ]);
    }),
);

test("Line numbers and Word wrap are checks under the ⋯ that redraw every File tab at once and are kept for the next launch", async () => {
  const one = mounted();
  const other = mounted();
  await one.draw(FILE);
  await other.draw("apps/web/README.md");
  const drawn = () =>
    [...document.querySelectorAll<HTMLElement>(".file-tab-lines")].map(
      (lines) => `${lines.dataset.lineNumbers} ${lines.dataset.wrap}`,
    );
  assert.deepEqual(drawn(), ["true true", "true true"]);

  await one.press(one.button("File actions"));
  assert.deepEqual(menuItems().slice(3), ["Line numbers ✓", "Word wrap ✓"]);
  await one.press(
    [...document.querySelectorAll('[role="menu"] button')].find(
      (item) => item.textContent === "Line numbers",
    ),
  );
  await chooseInMenu(other, "Word wrap");

  assert.deepEqual(drawn(), ["false false", "false false"]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("luke.file-view") ?? "null"), {
    lineNumbers: false,
    wordWrap: false,
  });
  await chooseInMenu(one, "Line numbers");
  await chooseInMenu(one, "Word wrap");
  assert.deepEqual(drawn(), ["true true", "true true"]);
});

test("the lines Luke showed, drawn where the file cannot be, follow the File tabs' settings too", async () => {
  const view = mounted();
  await view.draw(FILE);
  await chooseInMenu(view, "Line numbers");
  await chooseInMenu(view, "Word wrap");
  const snippet: PlanCode = {
    ref: { path: "src/moved.ts", startLine: 2, endLine: 2 },
    repository: REPOSITORY,
    firstLine: 1,
    lineCount: 3,
    lines: [[{ text: "a" }], [{ text: "b" }], [{ text: "c" }]],
  };
  const refused = mounted(
    [],
    undefined,
    () => Promise.resolve({ refusal: PLAN_FILE_REFUSAL.MISSING, branch: "main" }),
    undefined,
    snippet,
  );
  await refused.draw("src/moved.ts");

  const lines = refused.container.querySelector<HTMLElement>(".file-tab-lines");
  assert.equal(lines?.dataset.lineNumbers, "false");
  assert.equal(lines?.dataset.wrap, "false");
  await chooseInMenu(view, "Line numbers");
  await chooseInMenu(view, "Word wrap");
});

it.effect(
  "the ⋯ copies and saves the file as it holds it, read raw, its long lines uncut, and a file the service will not carry whole is refused with a word on where to read it",
  () =>
    Effect.gen(function* () {
      const saved = installSaveDialog();
      const clipboard = installClipboard();
      const registry = yield* registryOnTestClock;
      const toasts = createRoot(document.body.appendChild(document.createElement("div")));
      roots.push(toasts);
      act(() => toasts.render(onRegistry(registry, createElement(ToastHost))));
      const minified = `${"x".repeat(600)}\r\nend`;
      const long: ReadFileWindow = (window) =>
        Promise.resolve(
          window.raw === true
            ? {
                text: { path: window.path, repository: REPOSITORY, branch: "main", text: minified },
              }
            : {
                file: {
                  path: window.path,
                  repository: REPOSITORY,
                  branch: "main",
                  firstLine: 1,
                  lineCount: 2,
                  lines: [[{ text: "x".repeat(400) }], [{ text: "end" }]],
                },
              },
        );
      const view = mounted([], undefined, long, registry);
      yield* Effect.promise(() => view.draw("dist/bundle.js"));
      yield* Effect.promise(() => chooseInMenu(view, "Copy file contents"));
      yield* Effect.promise(() => chooseInMenu(view, "Download file"));
      yield* Effect.promise(() => view.settle());
      assert.deepEqual(clipboard.copied, [minified]);
      assert.deepEqual(saved, ["bundle.js: 2 lines"]);

      const grown: ReadFileWindow = (window) =>
        window.raw === true
          ? Promise.resolve({ refusal: PLAN_FILE_REFUSAL.NOT_TEXT })
          : long(window);
      const refused = mounted([], undefined, grown, registry);
      yield* Effect.promise(() => refused.draw("dist/grown.js"));
      yield* Effect.promise(() => chooseInMenu(refused, "Copy file contents"));
      yield* Effect.promise(() => refused.settle());
      assert.deepEqual(clipboard.copied, [minified]);
      assert.match(document.body.textContent ?? "", /too large to copy whole\. Open it on GitHub/);
    }),
);

test("a range Luke showed with a note stands his note over its first line: his mark and name, the lines, and his words as Markdown; a range shown without one, from another repository, or the whole file shown, stands none", async () => {
  const whole = shownLines("call-whole", 1, 1, "The whole file.");
  const view = mounted(
    [
      { ...whole, code: { ...whole.code, ref: { path: FILE } } },
      shownLines("call-guard", 4, 6, "The **invite** guard runs before the plan loads."),
      shownLines("call-bare", 10, 12, undefined),
      shownLines("call-elsewhere", 14, 14, "Another repository's line.", "acme/other"),
    ],
    undefined,
    numberedFile(40),
  );
  await view.draw(FILE, { startLine: 4, endLine: 6 });

  assert.deepEqual(noteCards(view.container), ["Luke's note on lines 4–6 over 4"]);
  const card = view.container.querySelector(".file-note");
  assert.equal(card?.querySelector(".file-note-author")?.textContent, "Luke");
  assert.ok(card?.querySelector(".luke-face"), "Luke's face as the Transcript draws it");
  assert.equal(card?.querySelector(".file-note-lines")?.textContent, "Lines 4–6");
  assert.equal(card?.querySelector(".file-note-words strong")?.textContent, "invite");
  assert.equal(card?.nextElementSibling?.getAttribute("data-pointed"), "true");
});

test("a file opened at a commit stands only the notes Luke wrote on lines his checkout read at that commit", async () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const other = "89abcdef0123456789abcdef0123456789abcdef";
  const view = mounted(
    [
      shownLines("call-here", 4, 6, "The invite guard.", REPOSITORY, commit),
      shownLines("call-before", 10, 12, "Read before commits were recorded."),
      shownLines("call-elsewhen", 14, 14, "Read at another commit.", REPOSITORY, other),
    ],
    undefined,
    numberedFile(40),
  );
  await view.draw(FILE, { startLine: 4, endLine: 6 }, 1, commit);

  assert.ok(view.container.querySelector(".code-line"), "the file is drawn");
  assert.deepEqual(noteCards(view.container), ["Luke's note on lines 4–6 over 4"]);
});

it.effect(
  "a note's age moves on with the minute while the tab stands open with nothing else drawn anew",
  () =>
    Effect.gen(function* () {
      const registry = yield* registryOnTestClock;
      const view = mounted(
        [shownLines("call-guard", 4, 6, "The invite guard.")],
        undefined,
        numberedFile(40),
        registry,
      );
      yield* Effect.promise(() => view.draw(FILE, { startLine: 4, endLine: 6 }));
      const age = () => view.container.querySelector(".file-note-time")?.textContent;
      assert.equal(age(), "now");

      yield* TestClock.adjust(Duration.minutes(10));
      yield* Effect.promise(() => view.settle());

      assert.equal(age(), "10m");
    }),
);

test("every range of the file with a note stands its own card, in the file's order, the newest note on a range speaking for it, whichever lines the tab lit", async () => {
  const view = mounted(
    [
      shownLines("call-late", 20, 24, "Where the plan is saved."),
      shownLines("call-first", 2, 2, "The route's door."),
      shownLines("call-again", 20, 24, "Where the plan is saved, now twice."),
    ],
    undefined,
    numberedFile(40),
  );
  await view.draw(FILE);

  assert.deepEqual(noteCards(view.container), [
    "Luke's note on line 2 over 2",
    "Luke's note on lines 20–24 over 20",
  ]);
  assert.match(
    view.container.querySelectorAll(".file-note-words")[1]?.textContent ?? "",
    /now twice/u,
  );
});

test("a note folds to its header, its words cut to one line there, as the tab holds it, and opens again; its link asks for the call's card in the Code tab", async () => {
  const note = "The invite guard runs before the plan loads.";
  const view = mounted([shownLines("call-guard", 4, 6, note)], undefined, numberedFile(40));
  await view.draw(FILE, { startLine: 4, endLine: 6 });
  const fold = () => view.container.querySelector(".file-note-fold");

  await view.press(fold());
  assert.equal(fold()?.getAttribute("aria-expanded"), "false");
  assert.equal(view.container.querySelector(".file-note-words"), null);
  assert.equal(view.container.querySelector(".file-note-preview")?.textContent, note);

  await view.press(fold());
  assert.equal(fold()?.getAttribute("aria-expanded"), "true");
  assert.equal(view.container.querySelector(".file-note-words")?.textContent, note);

  await view.press(view.container.querySelector(".file-note-show"));
  assert.deepEqual(view.notesShown, ["call-guard"]);
});

test("⌘F over the tab finds the words of Luke's note", async () => {
  const highlights = installHighlights();
  const view = mounted(
    [shownLines("call-guard", 4, 6, "The invite guard runs first.")],
    undefined,
    numberedFile(40),
  );
  await view.draw(FILE, { startLine: 4, endLine: 6 });

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
  });
  await view.settle();
  const input = view.container.querySelector<HTMLInputElement>(
    '.find-bar input[aria-label="Find"]',
  );
  assert.ok(input);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, "guard");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  assert.equal(view.container.querySelector(".find-bar-tally")?.textContent, "1 of 1");
  assert.deepEqual(highlights.matches(), ["guard"]);
});
