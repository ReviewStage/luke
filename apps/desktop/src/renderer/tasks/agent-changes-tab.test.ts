// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentPullRequestViewedAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CODING_AGENT_STATUS,
  type CodingAgentChangedFile,
  type CodingAgentSummary,
  DIFF_SIDE,
  PATCH_OMITTED,
} from "@luke/features/coding-agent-wire";
import {
  FILE_VIEWED_STATE,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestWriteAnswer,
} from "@luke/features/pull-request-write-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { DIFF_LAYOUT } from "@luke/settings/diff-view";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeAppBridge, fakeAppBridgeCalls } from "#testing/app-bridge";
import { handSettings } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import { landedBundles, onSideBundles } from "#testing/side-bundles";
import { codingAgentsControl } from "#testing/tasks-control";
import { appBridge } from "../app-bridge";
import { useAppCommand, useAppKeymap } from "../app-commands";
import type { SideBundles } from "../bundle-loader";
import type { DiffListProps, DiffViewModule } from "../diff-view/contract";
import type { FileTreeModule } from "../file-tree/contract";
import type { ChangesThreads } from "./agent-changes-tab";

/**
 * agent-changes-tab.test.ts -- a Files changed view hands the diff bundle
 * every file as one list, in the tree's order, each file's patch headed as
 * git writes one, a filter narrowing it, deleted files and lockfiles
 * folded, each fold and all of them turned by its controls and stage-cli's
 * keys, which J and K step through only inside the view; and how the File
 * tabs' settings draw it: unified with its changed words marked until told
 * otherwise, split once Split view is chosen in its ⋯, tinted whole once
 * Highlight changed words is turned off, each choice kept for the next
 * view; a diff too narrow to split is drawn unified, Split view dimmed, the
 * choice kept for a wider one. The settings are the app's own, read off the
 * document main hands the window and written back through it
 * (`handSettings`). The bundle, a chunk of its own the panel imports, is
 * stood in for at its importer, which records what it was handed. Synthetic
 * files only.
 */

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Seat limit",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PATCH = [
  "@@ -1,2 +1,3 @@",
  " const kept = true;",
  "-const seats = 3;",
  "+const seats = 42;",
  "+const extra = 1;",
].join("\n");

const PAGE = "https://github.com/acme/relay/pull/7";

/** A changed file of the pull request, modified with the seats patch unless told otherwise. */
function changed(
  path: string,
  overrides: Partial<CodingAgentChangedFile> = {},
): CodingAgentChangedFile {
  return {
    path,
    previousPath: null,
    status: CHANGED_FILE_STATUS.MODIFIED,
    additions: 2,
    deletions: 1,
    omitted: null,
    patch: PATCH,
    ...overrides,
  };
}

/** The commits the service names for a pull request's changed images, each where it named one. */
interface ImageCommits {
  readonly headSha?: string;
  readonly baseSha?: string;
}

/** The commits the service names for the pull request's changed images; none unless a test names them. */
let commits: ImageCommits = {};

/** The pull request's files, in the order GitHub lists them, which is not the tree's. */
let files: CodingAgentChangedFile[] = [changed("src/seats.ts")];

/** How the service answers the read of the member's viewed marks; unanswered unless a test answers it. */
let viewedAnswer: CodingAgentPullRequestViewedAnswerView = {
  failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
};
/** How many times the marks were read. */
let viewedReads = 0;
/** What the next read of the marks waits on, where a test holds it; none answers at once. */
let viewedHeld: Promise<void> | undefined;

const control = codingAgentsControl({
  agents: [AGENT],
  agentIds: [AGENT.id],
  models: [],
  readPullRequestViewed: () => {
    viewedReads += 1;
    const answer = viewedAnswer;
    return (viewedHeld ?? Promise.resolve()).then(() => answer);
  },
  readChanges: () =>
    Promise.resolve({
      pullRequest: {
        url: "https://github.com/acme/relay/pull/7",
        ...commits,
        truncated: false,
        files,
        reviewers: [],
        commitAuthors: [],
        comments: [],
      },
    }),
});

/** What the stand-in bundle was handed, mount first, each draw after it. */
let drawn: DiffListProps[] = [];
/** The files the list was scrolled to, in order. */
let revealed: string[] = [];
/** How wide the box the diff is drawn in lays out, in pixels. */
let boxWidth = 900;
let root: Root | undefined;

const standIn: DiffViewModule = {
  mount: () => ({ update: () => undefined, unmount: () => undefined }),
  mountList: (_host, props) => {
    drawn.push(props);
    return {
      update: (next) => drawn.push(next),
      reveal: (path) => revealed.push(path),
      unmount: () => undefined,
    };
  },
};

/** The doors each tree the view mounted opens a chosen file through, the latest last. */
let treeOpens: Array<(path: string, newTab: boolean) => void> = [];

/** The tree bundle, stood in for: it draws nothing and keeps the door its tree opens a file through. */
const treeStandIn: FileTreeModule = {
  mount: (_host, props) => {
    treeOpens.push(props.onOpen);
    const nothing = () => undefined;
    return {
      reveal: nothing,
      search: nothing,
      only: nothing,
      within: nothing,
      mark: nothing,
      unmount: nothing,
    };
  },
  fileIcon: () => ({ symbol: "", type: "" }),
};

let bundles: SideBundles;

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({
      diffView: () => Promise.resolve(standIn),
      fileTree: () => Promise.resolve(treeStandIn),
    }),
  );
});

beforeEach(() => {
  drawn = [];
  revealed = [];
  treeOpens = [];
  files = [changed("src/seats.ts")];
  commits = {};
  viewedAnswer = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
  viewedReads = 0;
  viewedHeld = undefined;
  boxWidth = 900;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.classList.contains("diff-view") ? boxWidth : 0;
    return new DOMRect(0, 0, width, 0);
  });
  fakeAppBridge({});
  handSettings();
});

afterEach(() => {
  watched.clear();
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The window's keymap with the Inbox's J offered, as the Inbox offers it while it stands, counting each run. */
function InboxBeside({ onNext }: { onNext: () => void }): null {
  useAppKeymap(true);
  useAppCommand(APP_COMMAND.NEXT_INBOX_ITEM, onNext);
  return null;
}

/** One registry for the tests' draws, so a draw again keeps the view's state as the panel would. */
let registry = AtomRegistry.make();

/** Draws the view again in the root standing, its tree open or not, beside whatever else is given. */
async function redraw(
  options: { threads?: ChangesThreads; treeOpen?: boolean; beside?: ReactElement } = {},
): Promise<DiffListProps> {
  const { AgentChangesTab } = await import("./agent-changes-tab");
  const tab = createElement(AgentChangesTab, {
    agentId: AGENT.id,
    control,
    shown: true,
    repository: "acme/relay",
    tree: { open: options.treeOpen ?? false, onToggle: () => undefined },
    threads: options.threads,
  });
  act(() =>
    root?.render(
      onRegistry(
        registry,
        onSideBundles(bundles, createElement("div", null, tab, options.beside ?? null)),
      ),
    ),
  );
  await flush();
  return lastDrawn();
}

/** Draws the agent's Files changed view afresh, its read landed, and answers what the list was last drawn with. */
async function drawTab(
  options: { threads?: ChangesThreads; treeOpen?: boolean; beside?: ReactElement } = {},
): Promise<DiffListProps> {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  registry = AtomRegistry.make();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  return redraw(options);
}

function lastDrawn(): DiffListProps {
  return drawn.at(-1) ?? assert.fail("the files are drawn");
}

/** The paths the list was last drawn with, each marked folded or not. */
function folds(): Array<[string, boolean]> {
  return lastDrawn().files.map((file) => [file.path, file.collapsed]);
}

/** Presses a key on `target`, answering whether something took it. */
function press(target: Element, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => target.dispatchEvent(event));
  return event.defaultPrevented;
}

/** The box the list is drawn in, inside the view. */
function listBox(): HTMLElement {
  return document.querySelector<HTMLElement>(".diff-list") ?? assert.fail("the list is drawn");
}

/** The header the view drew for a file, as the bundle stands it at the head of the file. */
function header(path: string): HTMLElement {
  const slot = lastDrawn().renderHeader(path);
  return slot.querySelector<HTMLElement>(".diff-list-head") ?? assert.fail(`${path} has a header`);
}

/** Types into the tree's search field as the developer would. */
function typeSearch(words: string): void {
  const field =
    document.querySelector<HTMLInputElement>('input[aria-label="Search files"]') ??
    assert.fail("the tree's search stands");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The ⋯'s item of a label, the menu opened. */
function menuItem(label: string): HTMLButtonElement {
  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
    (each) => each.textContent?.includes(label),
  );
  return item ?? assert.fail(`the ⋯ offers ${label}`);
}

/** Lets the document a settings write sends back land and be drawn. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Chooses a setting in the view's ⋯, and lets it be drawn. */
async function choose(label: string): Promise<void> {
  const item = menuItem(label);
  act(() => item.click());
  await flush();
}

/** How a diff is drawn until told otherwise: today's File tab look, and stage-cli's for what is new. */
const DEFAULT_LOOK = {
  layout: "unified",
  indicators: "bars",
  inlineDiff: "word-alt",
  backgrounds: true,
  lineNumbers: true,
  wrap: true,
  themes: { dark: "github-dark-default", light: "github-light-default" },
  font: "sf-mono",
  fontSize: "11.5",
  lineHeight: "normal",
  ligatures: false,
};

/** Opens the bar's diff settings, answering the popover. */
function openSettings(): HTMLElement {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Diff settings"]');
  act(() => button?.click());
  return (
    document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("the diff settings open")
  );
}

/** The popover's control of a name: a segment by its words, or a switch by its label. */
function settingControl(popover: HTMLElement, selector: string, name: string): HTMLButtonElement {
  const found = [...popover.querySelectorAll<HTMLButtonElement>(selector)].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  return found ?? assert.fail(`the settings offer ${name}`);
}

test("every file is handed over whole as git writes it, in the tree's order, drawn as today's File tab look until told otherwise", async () => {
  files = [changed("src/seats.ts"), changed("README.md"), changed("src/billing/plan.ts")];
  const props = await drawTab();

  assert.deepEqual(
    props.files.map((file) => file.path),
    ["src/billing/plan.ts", "src/seats.ts", "README.md"],
  );
  assert.equal(
    props.files[1]?.patch,
    `diff --git a/src/seats.ts b/src/seats.ts\n--- a/src/seats.ts\n+++ b/src/seats.ts\n${PATCH}\n`,
  );
  assert.deepEqual(props.look, DEFAULT_LOOK);
});

test("a file with no hunks to draw stands in the list as what is said in their place: why, and its review threads", async () => {
  files = [
    changed("logo.png", { omitted: PATCH_OMITTED.BINARY, patch: null, additions: 0, deletions: 0 }),
  ];
  const props = await drawTab({
    threads: {
      list: [{ ...seatsThread(2, "why-binary"), path: "logo.png" }],
      draw: (thread) => createElement("p", null, thread.comments[0]?.body),
    },
  });

  const [file] = props.files;
  assert.equal(file?.patch, "diff --git a/logo.png b/logo.png\n--- a/logo.png\n+++ b/logo.png\n");
  assert.equal(file?.lead, true);
  assert.deepEqual(file?.annotations, [{ key: "lead", side: "additions", line: 0 }]);
  const lead = props.renderAnnotation("logo.png", "lead");
  assert.equal(lead.querySelector(".diff-list-notice")?.textContent, "Binary file not shown.");
  assert.equal(
    lead.querySelector('[aria-label="Comments on lines this diff does not show"]')?.textContent,
    "why-binary",
  );
  assert.equal(
    header("logo.png").querySelector(".diff-list-notice"),
    null,
    "the header is one row",
  );
});

test("deleted files and lockfiles start folded, and a file's fold and Collapse all turn them", async () => {
  files = [
    changed("src/seats.ts"),
    changed("src/old.ts", { status: CHANGED_FILE_STATUS.DELETED }),
    changed("pnpm-lock.yaml"),
  ];
  await drawTab();
  assert.deepEqual(folds(), [
    ["src/old.ts", true],
    ["src/seats.ts", false],
    ["pnpm-lock.yaml", true],
  ]);

  act(() =>
    header("src/old.ts")
      .querySelector<HTMLButtonElement>('button[aria-label="Expand file"]')
      ?.click(),
  );
  await flush();
  assert.deepEqual(folds()[0], ["src/old.ts", false]);

  const foldAll = () =>
    document.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse all files"], button[aria-label="Expand all files"]',
    ) ?? assert.fail("the bar offers Collapse all");
  assert.equal(foldAll().getAttribute("aria-label"), "Collapse all files");
  act(() => foldAll().click());
  await flush();
  assert.ok(folds().every(([, collapsed]) => collapsed));

  assert.equal(foldAll().getAttribute("aria-label"), "Expand all files");
  act(() => foldAll().click());
  await flush();
  assert.ok(folds().every(([, collapsed]) => !collapsed));
});

test("the tree's search narrows the list, said over it while the tree is hidden, until cleared", async () => {
  files = [changed("src/seats.ts"), changed("src/billing/plan.ts"), changed("README.md")];
  await drawTab({ treeOpen: true });

  typeSearch("BILLING");
  await flush();
  assert.deepEqual(
    lastDrawn().files.map((file) => file.path),
    ["src/billing/plan.ts"],
  );

  await redraw({ treeOpen: false });
  const notice = [...document.querySelectorAll(".file-tab-notice")].find((each) =>
    each.textContent?.includes("Only files whose path holds"),
  );
  assert.match(notice?.textContent ?? "", /BILLING/u);
  act(() => notice?.querySelector("button")?.click());
  await flush();
  assert.equal(lastDrawn().files.length, 3);
});

test("a file the filter leaves out, chosen in a tree of every changed file, clears the filter and is scrolled to", async () => {
  files = [changed("src/seats.ts"), changed("src/billing/plan.ts"), changed("README.md")];
  await drawTab({ treeOpen: true });
  typeSearch("billing");
  await flush();
  assert.deepEqual(
    lastDrawn().files.map((file) => file.path),
    ["src/billing/plan.ts"],
  );

  const open = treeOpens.at(-1) ?? assert.fail("a tree is mounted");
  act(() => open("README.md", false));
  await flush();

  assert.equal(lastDrawn().files.length, 3, "the filter is cleared");
  assert.deepEqual(revealed, ["README.md"]);
  assert.match(document.querySelector(".file-view-bar")?.textContent ?? "", /README\.md/u);
});

test("J and K step through the files inside the view, ; and ⇧; fold, and Escape lets go of the file", async () => {
  files = [changed("a.ts"), changed("b.ts"), changed("c.ts")];
  await drawTab();
  const box = listBox();

  assert.ok(press(box, { key: "j" }), "J is the view's");
  assert.deepEqual(revealed, ["a.ts"], "a first press stands on the file at the top");
  press(box, { key: "j" });
  press(box, { key: "j" });
  press(box, { key: "k" });
  assert.deepEqual(revealed, ["a.ts", "b.ts", "c.ts", "b.ts"]);
  assert.ok(header("b.ts").hasAttribute("data-standing"));
  assert.match(document.querySelector(".file-view-bar")?.textContent ?? "", /b\.ts/u);

  press(box, { key: ";", code: "Semicolon" });
  await flush();
  assert.deepEqual(folds(), [
    ["a.ts", false],
    ["b.ts", true],
    ["c.ts", false],
  ]);
  press(box, { key: ":", code: "Semicolon", shiftKey: true });
  await flush();
  assert.ok(folds().every(([, collapsed]) => collapsed));

  assert.ok(press(box, { key: "Escape" }), "Escape lets go of the file stood on");
  assert.equal(header("b.ts").hasAttribute("data-standing"), false);
  assert.equal(press(box, { key: "Escape" }), false, "with none stood on, Escape is the window's");
});

test("J outside Files changed is still the Inbox's, and inside it is the view's alone", async () => {
  files = [changed("a.ts"), changed("b.ts")];
  let inboxNext = 0;
  await drawTab({ beside: createElement(InboxBeside, { onNext: () => (inboxNext += 1) }) });

  press(document.body, { key: "j" });
  assert.equal(inboxNext, 1, "outside the view J runs the Inbox's next item");
  assert.deepEqual(revealed, []);

  press(listBox(), { key: "j" });
  assert.equal(inboxNext, 1, "inside it J goes no further");
  assert.deepEqual(revealed, ["a.ts"]);
});

test("a key typed into the tree's search is the field's", async () => {
  files = [changed("a.ts"), changed("b.ts")];
  await drawTab({ treeOpen: true });
  const field =
    document.querySelector<HTMLInputElement>('input[aria-label="Search files"]') ??
    assert.fail("the tree's search stands");

  assert.equal(press(field, { key: "j" }), false);
  assert.deepEqual(revealed, []);
});

test("the diff settings set the layout, the indicators, and a switch for every diff, kept for the next view", async () => {
  await drawTab();
  const popover = openSettings();

  act(() => settingControl(popover, '[role="radio"]', "Split").click());
  act(() => settingControl(popover, '[role="radio"]', "Classic (+/-)").click());
  act(() => settingControl(popover, '[role="switch"]', "Ligatures").click());
  act(() => settingControl(popover, '[role="switch"]', "Backgrounds").click());
  await flush();

  const expected = {
    ...DEFAULT_LOOK,
    layout: "split",
    indicators: "classic",
    ligatures: true,
    backgrounds: false,
  };
  assert.deepEqual(lastDrawn().look, expected);
  assert.deepEqual((await drawTab()).look, expected);
});

test("Split view draws the diff side by side, which the next view keeps", async () => {
  await drawTab();

  await choose("Split view");
  assert.equal(lastDrawn().look.layout, "split");

  assert.equal((await drawTab()).look.layout, "split");
});

test("with Highlight changed words turned off a changed line is tinted whole, for this view and the next", async () => {
  await drawTab();

  await choose("Highlight changed words");
  assert.equal(lastDrawn().look.inlineDiff, "none");

  assert.equal((await drawTab()).look.inlineDiff, "none");
});

test("a list too narrow to split is drawn unified with Split view dimmed and its settings saying so, and split again once there is room", async () => {
  handSettings({ diffLayout: DIFF_LAYOUT.SPLIT });
  await drawTab();
  assert.equal(lastDrawn().look.layout, "split");

  boxWidth = 480;
  act(() => relayout());
  assert.equal(lastDrawn().look.layout, "unified");
  const item = menuItem("Split view");
  assert.equal(item.getAttribute("aria-disabled") ?? String(item.disabled), "true");
  assert.equal(item.getAttribute("aria-checked"), "false");
  act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  assert.match(openSettings().textContent ?? "", /Needs a wider panel/u);

  boxWidth = 900;
  act(() => relayout());
  assert.equal(lastDrawn().look.layout, "split");
});

test("a setting is drawn as written while its write is out, so a press reads the one before it", async () => {
  await drawTab();

  const item = menuItem("Highlight changed words");
  act(() => item.click());

  assert.equal(lastDrawn().look.inlineDiff, "none", "drawn before the document comes back");
  await flush();
  assert.equal(lastDrawn().look.inlineDiff, "none");
});

/** Holds every settings write unanswered, and the window's document unchanged, until a test answers one. */
function holdSettingWrites(): Array<(outcome: ActOutcome) => void> {
  const held: Array<(outcome: ActOutcome) => void> = [];
  const before = appBridge().act;
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    act: (request: Act) =>
      request.kind === ACT_KIND.SETTING_UPDATE
        ? new Promise((resolve) => held.push(resolve))
        : before(request),
  });
  return held;
}

test("a write answered while a later one to the same setting is out leaves the later one drawn", async () => {
  await drawTab();
  const held = holdSettingWrites();
  const popover = openSettings();

  act(() => settingControl(popover, '[role="radio"]', "Split").click());
  act(() => settingControl(popover, '[role="radio"]', "Unified").click());
  act(() => settingControl(popover, '[role="radio"]', "Split").click());
  held[0]?.({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
  await flush();

  assert.equal(lastDrawn().look.layout, "split");
});

test("a refused write is said under its row, and the row can be pressed again", async () => {
  await drawTab();
  const held = holdSettingWrites();
  const popover = openSettings();

  act(() => settingControl(popover, '[role="switch"]', "Ligatures").click());
  held[0]?.({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not save that setting." });
  await flush();

  const ligatures = settingControl(popover, '[role="switch"]', "Ligatures");
  assert.equal(ligatures.getAttribute("aria-invalid"), "true", "the refusal is said");
  assert.match(
    (ligatures.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" "),
    /Could not save that setting/u,
    "under its own row",
  );
  assert.equal(ligatures.disabled, false);
  assert.equal(lastDrawn().look.ligatures, false);
});

/** A review thread on the seats file, on its new side's line, or outdated where its line is gone. */
function seatsThread(line: number | null, words: string) {
  return {
    path: "src/seats.ts",
    line,
    startLine: null,
    originalLine: 2,
    originalStartLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    diffHunk: PATCH,
    resolved: false,
    outdated: line === null,
    comments: [
      {
        by: { login: "octo", bot: false },
        html: null,
        body: words,
        at: 1,
        url: `${PAGE}#${words}`,
      },
    ],
    more: 0,
  };
}

test("a review thread is drawn under its line in its file, and one a push outdated stands above the file's first hunk", async () => {
  const threads: ChangesThreads = {
    list: [seatsThread(2, "why-42"), seatsThread(null, "was-3")],
    draw: (thread) => createElement("p", { className: "drawn-thread" }, thread.comments[0]?.body),
  };
  const props = await drawTab({ threads });

  const [outdated, current] = props.files[0]?.annotations ?? [];
  assert.deepEqual(current, { key: `${PAGE}#why-42`, side: "additions", line: 2 });
  assert.equal(props.renderAnnotation("src/seats.ts", `${PAGE}#why-42`).textContent, "why-42");
  assert.equal(outdated?.side, "additions");
  assert.equal(outdated?.line, 0);
  const above = props.renderAnnotation("src/seats.ts", outdated?.key ?? "");
  assert.equal(
    above.querySelector('[aria-label="Comments on lines this diff does not show"]')?.textContent,
    "was-3",
  );
});

test("Refresh changes reads the review threads again with the files, so the two describe the same push", async () => {
  let threadReads = 0;
  await drawTab({
    threads: {
      list: [],
      draw: () => null,
      refresh: () => {
        threadReads += 1;
      },
    },
  });

  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent?.includes("Refresh changes"),
  );
  act(() => refresh?.click());

  assert.equal(threadReads, 1);
});

/** What an intersection observer is told of an element coming into view, as far as the view reads it. */
type InView = (entries: readonly { readonly isIntersecting: boolean }[]) => void;

/** Every element an intersection observer watches, with the observer's callback, as the window would report one coming into view. */
const watched = new Map<Element, InView>();

/** An intersection observer that reports an element in view only once something calls `comeIntoView`, and only an element a document holds. */
class StandInIntersectionObserver {
  readonly #callback: InView;
  constructor(callback: InView) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    watched.set(target, this.#callback);
  }
  disconnect(): void {
    for (const [target, callback] of watched)
      if (callback === this.#callback) watched.delete(target);
  }
}

/** Reports every watched element a document holds as in view, as Pierre standing its file near the view would. */
function comeIntoView(): void {
  for (const [target, callback] of [...watched]) {
    if (!target.isConnected) continue;
    act(() => callback([{ isIntersecting: true }]));
  }
}

/** The images the service was asked for, by address, each answered with a picture of its own. */
function answerImages(refusing: Set<string> = new Set()): string[] {
  const asked: string[] = [];
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_GITHUB_IMAGE) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      }
      asked.push(request.payload.src);
      if (refusing.has(request.payload.src)) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Unreachable." });
      }
      return Promise.resolve({
        status: ACT_OUTCOME_STATUS.DONE,
        value: { contentType: "image/png", base64: btoa(request.payload.src) },
      });
    },
  });
  handSettings();
  return asked;
}

/** Stands what a file draws in the place of its lines where Pierre would, in the document near the view, and lets its pictures be read. */
async function standNearView(path: string): Promise<HTMLElement> {
  const file = lastDrawn().files.find((each) => each.path === path);
  assert.equal(file?.lead, true, `${path} is drawn as its lead`);
  const slot = lastDrawn().renderAnnotation(path, "lead");
  document.body.append(slot);
  comeIntoView();
  await flush();
  return slot;
}

const HEAD_SHA = "1".repeat(40);
const MERGE_BASE_SHA = "2".repeat(40);

test("a changed image is read at the merge base and the head only once it comes near the view, and drawn before and after", async () => {
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
  const asked = answerImages();
  commits = { headSha: HEAD_SHA, baseSha: MERGE_BASE_SHA };
  files = [
    changed("assets/logo.png", {
      previousPath: "assets/old logo.png",
      status: CHANGED_FILE_STATUS.RENAMED,
      omitted: PATCH_OMITTED.BINARY,
      patch: null,
    }),
  ];
  const props = await drawTab();

  assert.equal(
    props.files[0]?.patch,
    "diff --git a/assets/old logo.png b/assets/logo.png\n--- a/assets/old logo.png\n+++ b/assets/logo.png\n",
  );
  assert.deepEqual(asked, [], "nothing is read before Pierre stands the file near the view");

  const slot = await standNearView("assets/logo.png");
  assert.deepEqual(asked, [
    `https://raw.githubusercontent.com/acme/relay/${MERGE_BASE_SHA}/assets/old%20logo.png`,
    `https://raw.githubusercontent.com/acme/relay/${HEAD_SHA}/assets/logo.png`,
  ]);
  const pictures = [...slot.querySelectorAll<HTMLImageElement>("img")];
  assert.deepEqual(
    pictures.map((picture) => picture.alt),
    ["Before", "After"],
  );
  assert.equal(pictures[1]?.src, `data:image/png;base64,${btoa(asked[1] ?? "")}`);

  const swipe = [...slot.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (each) => each.textContent === "Swipe",
  );
  act(() => swipe?.click());
  assert.ok(slot.querySelector('input[aria-label="Swipe between the two"]'));
  assert.equal(slot.querySelectorAll(".image-diff-stack img").length, 2);
});

test("a changed image whose merge base the service could not read draws its after alone, saying the before is unavailable", async () => {
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
  const asked = answerImages();
  commits = { headSha: "3".repeat(40) };
  files = [changed("logo.webp", { omitted: PATCH_OMITTED.BINARY, patch: null })];
  await drawTab();

  const slot = await standNearView("logo.webp");
  assert.deepEqual(asked, [
    `https://raw.githubusercontent.com/acme/relay/${"3".repeat(40)}/logo.webp`,
  ]);
  assert.equal(slot.querySelectorAll("img").length, 1);
  assert.match(slot.textContent ?? "", /Previous version unavailable/u);
});

test("an SVG is drawn as a picture until its source is asked for, and its lines then", async () => {
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
  answerImages();
  commits = { headSha: "4".repeat(40), baseSha: "5".repeat(40) };
  files = [changed("icon.svg")];
  await drawTab();
  assert.equal(
    lastDrawn().files[0]?.patch,
    "diff --git a/icon.svg b/icon.svg\n--- a/icon.svg\n+++ b/icon.svg\n",
  );

  act(() =>
    header("icon.svg")
      .querySelector<HTMLButtonElement>('button[aria-label="Show source"]')
      ?.click(),
  );
  await flush();
  assert.match(lastDrawn().files[0]?.patch ?? "", /@@ -1,2 \+1,3 @@/u);
});

test("an image of a service that names no commits is a binary file, as before", async () => {
  files = [changed("logo.png", { omitted: PATCH_OMITTED.BINARY, patch: null })];
  await drawTab();

  assert.equal(
    lastDrawn().renderAnnotation("logo.png", "lead").querySelector(".diff-list-notice")
      ?.textContent,
    "Binary file not shown.",
  );
});

test("an image side whose read did not land is asked for again when the changes are read again", async () => {
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
  const after = `https://raw.githubusercontent.com/acme/relay/${"6".repeat(40)}/logo.png`;
  const refusing = new Set([after]);
  const asked = answerImages(refusing);
  commits = { headSha: "6".repeat(40) };
  files = [
    changed("logo.png", {
      status: CHANGED_FILE_STATUS.ADDED,
      omitted: PATCH_OMITTED.BINARY,
      patch: null,
    }),
  ];
  await drawTab();
  let slot = await standNearView("logo.png");
  assert.match(slot.textContent ?? "", /could not be shown/u);

  refusing.clear();
  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent?.includes("Refresh changes"),
  );
  act(() => refresh?.click());
  await flush();
  slot = await standNearView("logo.png");

  assert.deepEqual(asked, [after, after]);
  assert.equal(slot.querySelector("img")?.alt, "Added");
});

test("an SVG moved with its contents unchanged offers no source, having no lines to show", async () => {
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
  answerImages();
  commits = { headSha: "7".repeat(40), baseSha: "8".repeat(40) };
  files = [
    changed("logo.svg", {
      previousPath: "icon.svg",
      status: CHANGED_FILE_STATUS.RENAMED,
      additions: 0,
      deletions: 0,
      patch: "",
    }),
  ];
  await drawTab();

  assert.equal(lastDrawn().files[0]?.lead, true, "it is drawn as its pictures");
  assert.equal(
    header("logo.svg").querySelector('button[aria-label="Show source"]') === null,
    true,
    "no Show source is offered",
  );
});

test("the comparison chosen for an image, and how far it is faded, outlast Refresh changes", async () => {
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
  answerImages();
  commits = { headSha: "9".repeat(40), baseSha: "a".repeat(40) };
  files = [changed("logo.png", { omitted: PATCH_OMITTED.BINARY, patch: null })];
  await drawTab();
  let slot = await standNearView("logo.png");
  const onion = [...slot.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (each) => each.textContent === "Onion skin",
  );
  act(() => onion?.click());
  const fade = () =>
    slot.querySelector<HTMLInputElement>('input[aria-label="Fade the after over the before"]') ??
    assert.fail("the fade's slider stands");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(fade(), "80");
    fade().dispatchEvent(new Event("input", { bubbles: true }));
  });

  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent?.includes("Refresh changes"),
  );
  act(() => refresh?.click());
  await flush();
  slot = await standNearView("logo.png");

  assert.equal(fade().value, "80");
});

test("after Refresh changes an image far from the view reads nothing until it comes near again", async () => {
  vi.stubGlobal("IntersectionObserver", StandInIntersectionObserver);
  const asked = answerImages();
  commits = { headSha: "b".repeat(40) };
  files = [
    changed("logo.png", {
      status: CHANGED_FILE_STATUS.ADDED,
      omitted: PATCH_OMITTED.BINARY,
      patch: null,
    }),
  ];
  await drawTab();
  const slot = await standNearView("logo.png");
  assert.equal(asked.length, 1);
  // Pierre takes the file's place away as it scrolls far from the view.
  slot.remove();

  commits = { headSha: "c".repeat(40) };
  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent?.includes("Refresh changes"),
  );
  act(() => refresh?.click());
  await flush();
  comeIntoView();
  await flush();
  assert.equal(asked.length, 1, "nothing is read while the file is far from the view");

  await standNearView("logo.png");
  assert.deepEqual(
    asked.at(-1),
    `https://raw.githubusercontent.com/acme/relay/${"c".repeat(40)}/logo.png`,
  );
});

/** The viewed marks the service names: the seats file viewed, the plan viewed and changed since, the readme not. */
const MARKED: CodingAgentPullRequestViewedAnswerView = {
  outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
  files: [
    { path: "a.ts", state: FILE_VIEWED_STATE.VIEWED },
    { path: "b.ts", state: FILE_VIEWED_STATE.DISMISSED },
    { path: "c.ts", state: FILE_VIEWED_STATE.UNVIEWED },
  ],
};

/** Every mark asked of the service, answered as `answer` says. */
function answerMarks(answer: () => PullRequestWriteAnswer): PullRequestActionRequest[] {
  const asked: PullRequestActionRequest[] = [];
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      }
      asked.push(request.payload.request);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: answer() });
    },
  });
  handSettings();
  return asked;
}

/** The Viewed box in a file's header. */
function viewedBox(path: string): HTMLInputElement {
  return (
    header(path).querySelector<HTMLInputElement>('.diff-list-viewed input[type="checkbox"]') ??
    assert.fail(`${path} offers a Viewed box`)
  );
}

test("the member's viewed marks tick their files, count toward the foot's progress, and fold them; a file changed since reads not viewed", async () => {
  viewedAnswer = MARKED;
  files = [changed("a.ts"), changed("b.ts"), changed("c.ts")];
  await drawTab();

  assert.deepEqual(
    ["a.ts", "b.ts", "c.ts"].map((path) => viewedBox(path).checked),
    [true, false, false],
  );
  assert.deepEqual(folds(), [
    ["a.ts", true],
    ["b.ts", false],
    ["c.ts", false],
  ]);
  assert.match(document.querySelector(".file-tree-foot")?.textContent ?? "", /1 \/ 3 viewed/u);
});

test("ticking a file's box marks it viewed on GitHub at once and folds it; one GitHub refuses goes back and says why", async () => {
  viewedAnswer = MARKED;
  let refuse = false;
  const asked = answerMarks(() =>
    refuse
      ? { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Pull request is locked." }
      : { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE },
  );
  files = [changed("a.ts"), changed("b.ts"), changed("c.ts")];
  await drawTab();

  act(() => viewedBox("c.ts").click());
  await flush();
  assert.equal(viewedBox("c.ts").checked, true);
  assert.deepEqual(folds()[2], ["c.ts", true]);
  assert.match(document.querySelector(".file-tree-foot")?.textContent ?? "", /2 \/ 3 viewed/u);

  refuse = true;
  act(() => viewedBox("a.ts").click());
  await flush();
  assert.equal(viewedBox("a.ts").checked, true, "a refused unmark leaves the mark standing");
  assert.match(
    document.querySelector('[role="alert"]')?.textContent ?? "",
    /Pull request is locked\./u,
  );
  assert.deepEqual(asked, [
    { action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: "c.ts" },
    { action: PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED, path: "a.ts" },
  ]);
});

test("V marks the file the keys stand on viewed and steps on to the next, and is no key at all until the marks are read", async () => {
  files = [changed("a.ts"), changed("b.ts"), changed("c.ts")];
  const asked = answerMarks(() => ({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE }));
  await drawTab();
  assert.equal(press(listBox(), { key: "v" }), false, "with no marks read V is not the list's");

  viewedAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, files: [] };
  await drawTab();
  press(listBox(), { key: "j" });
  press(listBox(), { key: "v" });
  await flush();

  assert.deepEqual(asked, [{ action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: "a.ts" }]);
  assert.ok(header("b.ts").hasAttribute("data-standing"));
  assert.equal(viewedBox("a.ts").checked, true);
});

test("a member with no GitHub sign-in is offered one, and no Viewed box stands until the marks are read", async () => {
  viewedAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED };
  files = [changed("a.ts")];
  await drawTab();

  assert.equal(header("a.ts").querySelector(".diff-list-viewed") === null, true);
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Sign in with GitHub/u);
});

test("the marks are read again with the files on Refresh changes, so the two describe the same push", async () => {
  viewedAnswer = MARKED;
  files = [changed("a.ts")];
  await drawTab();
  assert.equal(viewedReads, 1);

  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent?.includes("Refresh changes"),
  );
  act(() => refresh?.click());
  await flush();

  assert.equal(viewedReads, 2);
});

/** Every mark asked of the service, each held until the test answers it. */
function holdMarks(): Array<{
  readonly request: PullRequestActionRequest;
  readonly answer: (answer: PullRequestWriteAnswer) => void;
}> {
  const held: Array<{
    readonly request: PullRequestActionRequest;
    readonly answer: (answer: PullRequestWriteAnswer) => void;
  }> = [];
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      }
      const answered = Promise.withResolvers<ActOutcome>();
      held.push({
        request: request.payload.request,
        answer: (value) => answered.resolve({ status: ACT_OUTCOME_STATUS.DONE, value }),
      });
      return answered.promise;
    },
  });
  handSettings();
  return held;
}

const DONE: PullRequestWriteAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };

test("presses on one file go to GitHub one at a time, the last of them winning, whatever order GitHub could have answered them in", async () => {
  viewedAnswer = MARKED;
  const held = holdMarks();
  files = [changed("c.ts")];
  await drawTab();

  act(() => viewedBox("c.ts").click());
  act(() => viewedBox("c.ts").click());
  await flush();
  assert.equal(held.length, 1, "the second press waits for the first");
  assert.equal(viewedBox("c.ts").checked, false);

  held[0]?.answer(DONE);
  await flush();
  assert.deepEqual(
    held.map((each) => each.request),
    [
      { action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: "c.ts" },
      { action: PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED, path: "c.ts" },
    ],
  );
  held[1]?.answer(DONE);
  await flush();
  assert.equal(viewedBox("c.ts").checked, false);
  assert.match(document.querySelector(".file-tree-foot")?.textContent ?? "", /0 \/ 1 viewed/u);
});

test("a read asked before a mark settled never undoes it, and a read that does not answer takes the boxes away", async () => {
  viewedAnswer = MARKED;
  const held = holdMarks();
  files = [changed("c.ts")];
  await drawTab();

  // A refresh's read stays out while the member marks the file and GitHub takes it.
  const reading = Promise.withResolvers<void>();
  viewedHeld = reading.promise;
  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent?.includes("Refresh changes"),
  );
  act(() => refresh?.click());
  await flush();
  act(() => viewedBox("c.ts").click());
  await flush();
  held[0]?.answer(DONE);
  await flush();
  reading.resolve();
  await flush();
  assert.equal(viewedBox("c.ts").checked, true, "the read from before the mark leaves it standing");

  viewedHeld = undefined;
  viewedAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED };
  act(() => options?.click());
  const again = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent?.includes("Refresh changes"),
  );
  act(() => again?.click());
  await flush();
  assert.equal(header("c.ts").querySelector(".diff-list-viewed") === null, true);
});

test("unmarking a deleted file opens it, and a press GitHub refuses puts back the fold chosen before", async () => {
  viewedAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
    files: [{ path: "old.ts", state: FILE_VIEWED_STATE.VIEWED }],
  };
  let refuse = false;
  answerMarks(() =>
    refuse ? { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Locked." } : DONE,
  );
  files = [changed("old.ts", { status: CHANGED_FILE_STATUS.DELETED }), changed("new.ts")];
  await drawTab();
  assert.deepEqual(folds()[1], ["old.ts", true]);

  act(() => viewedBox("old.ts").click());
  await flush();
  assert.deepEqual(folds()[1], ["old.ts", false], "unmarked, the deleted file opens");

  refuse = true;
  act(() => viewedBox("new.ts").click());
  await flush();
  assert.deepEqual(folds()[0], ["new.ts", false], "a refused mark leaves the file as it was");
});

const REFUSED: PullRequestWriteAnswer = {
  outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
  words: "Try again later.",
};

test("a mark GitHub took stands where the press queued after it is refused, as GitHub holds it", async () => {
  viewedAnswer = MARKED;
  const held = holdMarks();
  files = [changed("c.ts")];
  await drawTab();

  act(() => viewedBox("c.ts").click());
  act(() => viewedBox("c.ts").click());
  held[0]?.answer(DONE);
  await flush();
  held[1]?.answer(REFUSED);
  await flush();

  assert.equal(viewedBox("c.ts").checked, true);
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Try again later\./u);
});

test("a last press GitHub was never asked for is sent even where the press before it was refused", async () => {
  viewedAnswer = MARKED;
  const held = holdMarks();
  files = [changed("c.ts")];
  await drawTab();

  act(() => viewedBox("c.ts").click());
  act(() => viewedBox("c.ts").click());
  act(() => viewedBox("c.ts").click());
  held[0]?.answer(REFUSED);
  await flush();
  assert.equal(held.length, 2, "the last press, a mark, is asked for again");
  held[1]?.answer(DONE);
  await flush();

  assert.equal(viewedBox("c.ts").checked, true);
  assert.equal(document.querySelector('[role="alert"]') === null, true);
});

test("a refused mark leaves a fold chosen since, as Collapse all chose it", async () => {
  viewedAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, files: [] };
  const held = holdMarks();
  files = [changed("a.ts"), changed("b.ts")];
  await drawTab();

  act(() => viewedBox("a.ts").click());
  await flush();
  const foldAll =
    document.querySelector<HTMLButtonElement>('button[aria-label="Collapse all files"]') ??
    assert.fail("the bar offers Collapse all");
  act(() => foldAll.click());
  await flush();
  held[0]?.answer(REFUSED);
  await flush();

  assert.deepEqual(folds(), [
    ["a.ts", true],
    ["b.ts", true],
  ]);
});
