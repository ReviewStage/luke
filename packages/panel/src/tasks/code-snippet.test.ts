// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { InboxCodeBlock } from "@luke/features/inbox-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import { TASK_FILE_REFUSAL } from "@luke/features/task-wire";
import type { TaskCodeShowing, TasksFileAnswer } from "@luke/features/tasks-view";
import { getSharedHighlighter } from "@pierre/diffs";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { preferredHighlighter } from "../diff-view/highlight-pool.js";
import { diffView } from "../diff-view/index.js";
import { FindScope } from "../find-in-tab.js";
import { copyingInto, DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { CodePane } from "./code-pane.js";
import { FileTab } from "./file-tab.js";
import { InboxCodeCard } from "./inbox-code-card.js";
import { OpenLinkProvider } from "./use-open-link.js";

/**
 * code-snippet.test.ts -- a Code tab card's lines, and an inbox item's code,
 * drawn by the diff bundle: numbered from where they sit in the file, the
 * lines pointed at lit, and Luke's note under the last of them, on the card
 * every note on code stands on, whose ⋯ opens and links the turn that
 * showed the lines and which lights its lines under the pointer; with
 * Minimize inline comments on, the note is a chip until it is shown. The
 * real bundle draws in jsdom on the window's own thread, since no worker
 * text was built in. A call standing starts the bundle loading, so the
 * first card it shows need not wait on it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SHOWN_AT = 1_760_000_000_000;
const AGENT_ID = "3f1c9e2a-6b7d-4e8f-a1b2-c3d4e5f60718";
const AGENT_NAME = "Invite emails";
const NOTE = "A used invite is refused here.";

/** Lines 12–15 of a file, an agent of the task pointing at 13–14 with a note. */
const SHOWING: TaskCodeShowing = {
  callId: "show-1",
  turnId: "turn-1",
  agentId: AGENT_ID,
  shownAt: SHOWN_AT,
  code: {
    ref: { path: "src/invites/accept.ts", startLine: 13, endLine: 14 },
    repository: "acme/relay",
    firstLine: 12,
    lineCount: 40,
    lines: ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"],
    note: NOTE,
  },
};

let bundles: SideBundles;
const roots: Root[] = [];

beforeAll(async () => {
  bundles = await Effect.runPromise(landedBundles({ diffView: () => Promise.resolve(diffView) }));
  // Note that the highlighter is loaded first, in the default themes and on the
  // highlighter the bundle picks, so Pierre draws the first card within the
  // test's own ticks rather than whenever a cold load lets it on a busy machine.
  await getSharedHighlighter({
    themes: ["github-dark-default", "github-light-default"],
    langs: ["typescript"],
    preferredHighlighter: preferredHighlighter(),
  });
});

beforeEach(() => handSettings());

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Lets the settings' read and Pierre's next frame land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
}

/** The element drawn over the landed bundle, the links it opens recorded. */
async function draw(element: ReactElement, opened: ReadLink[] = []): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          bundles,
          createElement(
            OpenLinkProvider,
            { value: (link: ReadLink) => opened.push(link) },
            createElement(LinkWorkspaceProvider, { value: "acme" }, element),
          ),
        ),
      ),
    ),
  );
  await settle();
  return container;
}

/** The Code tab holding the showings given. */
function codeTab(shown: readonly TaskCodeShowing[] = [SHOWING]): ReactElement {
  return createElement(CodePane, {
    shown,
    calls: [],
    taskId: TASK_ID,
    onOpenFile: () => {},
    agentLabel: (agentId: string) => (agentId === AGENT_ID ? AGENT_NAME : undefined),
  });
}

/** The shadow root Pierre drew a card's lines in. */
function drawnRoot(container: HTMLElement): ShadowRoot {
  const root = container.querySelector(".code-snippet diffs-container")?.shadowRoot;
  assert.ok(root, "the lines are drawn by the diff bundle");
  return root;
}

/** The numbers of the rows of code drawn, in order, those matching `selector`. */
function drawnLines(container: HTMLElement, selector = "[data-line]"): number[] {
  return [...drawnRoot(container).querySelectorAll(selector)].map((row) =>
    Number(row.getAttribute("data-line")),
  );
}

/** The lines lit. */
function litLines(container: HTMLElement): number[] {
  return drawnLines(container, "[data-line][data-selected-line]");
}

test("a card's lines are drawn numbered from where they sit in the file, the lines it pointed at lit", async () => {
  const container = await draw(codeTab());
  assert.deepEqual(drawnLines(container), [12, 13, 14, 15]);
  assert.equal(drawnRoot(container).querySelector('[data-line="13"]')?.textContent, "const b = 2;");
  assert.deepEqual(litLines(container), [13, 14]);
});

test("a card is a code card: its header names the file and the lines, its one Copy copies the lines pointed at, and the file's opening stands beside it", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const container = await draw(codeTab());
  const head = container.querySelector(".luke-code-card figcaption") ?? assert.fail("no header");
  assert.match(head.textContent ?? "", /accept\.ts/u);
  assert.match(head.textContent ?? "", /13–14/u);
  assert.ok(head.querySelector('button[aria-label="Open file"]'), "the file opens from the header");
  const copies = [...head.querySelectorAll<HTMLButtonElement>('button[aria-label^="Copy"]')];
  assert.deepEqual(
    copies.map((button) => button.getAttribute("aria-label")),
    ["Copy code"],
  );
  await act(async () => copies[0]?.click());
  assert.deepEqual(copied, ["const b = 2;\nconst c = 3;"]);
});

test("an agent's note stands under the last line it pointed at, headed by the agent's name, and the card no longer says it above the lines", async () => {
  const container = await draw(codeTab());
  const note = container.querySelector(".code-snippet .file-note");
  assert.ok(note, "the note is drawn in the diff's own element");
  assert.equal(
    note.closest(".diff-note")?.parentElement?.getAttribute("slot"),
    "annotation-additions-14",
  );
  assert.ok(drawnRoot(container).querySelector('slot[name="annotation-additions-14"]'));
  assert.match(
    note.querySelector(".annotation-card-fold > summary")?.textContent ?? "",
    /^Invite emails/u,
  );
  assert.equal((container.textContent ?? "").split(NOTE).length - 1, 1, "the note is said once");
});

test("a note on a file shown from its top stands under the card's last line, and the pointer on it lights every line", async () => {
  const whole: TaskCodeShowing = {
    ...SHOWING,
    code: { ...SHOWING.code, ref: { path: SHOWING.code.ref.path } },
  };
  const container = await draw(codeTab([whole]));
  assert.deepEqual(litLines(container), [], "nothing is pointed at");
  const note = container.querySelector<HTMLElement>(".file-note");
  assert.equal(
    note?.closest(".diff-note")?.parentElement?.getAttribute("slot"),
    "annotation-additions-15",
  );
  assert.ok(note);
  act(() => note.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await settle();
  assert.deepEqual(litLines(container), [12, 13, 14, 15]);
  act(() => note.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  await settle();
  assert.deepEqual(litLines(container), []);
});

test("a note's ⋯ opens the agent's turn that showed the lines and copies its link", async () => {
  const opened: ReadLink[] = [];
  const copied: string[] = [];
  fakeAppPlatform({ ...DESKTOP_LINKS, ...copyingInto(copied) });
  const container = await draw(codeTab(), opened);
  const press = (label: string) => {
    act(() =>
      (
        container.querySelector<HTMLButtonElement>('button[aria-label="Note actions"]') ??
        assert.fail("the note has its ⋯")
      ).click(),
    );
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    act(() => items.find((item) => item.textContent === label)?.click());
  };
  press("View in conversation");
  assert.deepEqual(
    opened.map((link) => link.place),
    [{ kind: LINK_PLACE.MESSAGE, planId: TASK_ID, agentId: AGENT_ID, messageId: "turn-1" }],
  );
  press("Copy link");
  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${TASK_ID}/agent/${AGENT_ID}/message/turn-1`,
  ]);
});

test("a press on the note's head folds it to its head alone", async () => {
  const container = await draw(codeTab());
  const head = container.querySelector<HTMLElement>(".file-note summary");
  assert.equal(head?.getAttribute("aria-expanded"), "true");
  act(() => head?.click());
  await settle();
  assert.equal(
    container.querySelector(".file-note summary")?.getAttribute("aria-expanded"),
    "false",
  );
});

test("with Minimize inline comments on, the note is a chip on its line until the chip shows it", async () => {
  handSettings({ diffMinimizeComments: true });
  const container = await draw(codeTab());
  const chip = container.querySelector<HTMLElement>(
    ".code-snippet .diff-thread-chip-row > summary",
  );
  assert.ok(chip, "the chip stands in the note's place");
  assert.equal(chip.getAttribute("aria-label"), "Invite emails's note on lines 13–14, show");
  assert.equal(
    chip.closest(".diff-note")?.parentElement?.getAttribute("slot"),
    "annotation-additions-14",
  );
  assert.equal(chip.closest("details")?.hasAttribute("open"), false, "the note is put away");
  act(() => chip.click());
  await settle();
  assert.equal(chip.closest("details")?.hasAttribute("open"), true, "the chip shows the note");
  assert.equal(
    container.querySelector(".diff-thread-chip-row > summary")?.getAttribute("aria-label"),
    "Invite emails's note on lines 13–14, hide",
  );
});

test("an inbox item's code draws the lines it read as a Code card's, those it named lit", async () => {
  const block: InboxCodeBlock = {
    type: "code",
    repo: "acme/relay",
    path: "src/seats.ts",
    sha: "0123456789abcdef0123456789abcdef01234567",
    startLine: 5,
    endLine: 5,
  };
  const answer: TasksFileAnswer = {
    file: {
      path: "src/seats.ts",
      repository: "acme/relay",
      branch: "main",
      firstLine: 2,
      lineCount: 20,
      lines: [2, 3, 4, 5, 6, 7, 8].map((line) => `line ${line}`),
    },
  };
  const container = await draw(
    createElement(InboxCodeCard, {
      block,
      code: {
        repository: "acme/relay",
        readFile: () => Promise.resolve(answer),
        onOpenFile: () => {},
      },
    }),
  );
  assert.deepEqual(drawnLines(container), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(drawnRoot(container).querySelector('[data-line="5"]')?.textContent, "line 5");
  assert.deepEqual(litLines(container), [5]);
});

test("a File tab whose file is refused draws Luke's lines as a card does, his notes on them under their lines, scrolling in the room the notice leaves", async () => {
  const { code } = SHOWING;
  const container = await draw(
    createElement(
      FindScope,
      { active: true, subject: { task: TASK_ID, tab: { file: code.ref.path } } },
      createElement(FileTab, {
        file: { path: code.ref.path, range: { startLine: 13, endLine: 14 }, opened: 1 },
        snippet: code,
        notes: {
          notes: [
            { callId: "call-1", shownAt: SHOWN_AT, startLine: 13, endLine: 14, note: NOTE },
            { callId: "call-2", shownAt: SHOWN_AT, startLine: 15, endLine: 20, note: "Runs past." },
            { callId: "call-3", shownAt: SHOWN_AT, startLine: 30, endLine: 31, note: "Elsewhere." },
          ],
          folded: [],
          onFold: () => {},
          taskId: TASK_ID,
        },
        readFile: () => Promise.resolve({ refusal: TASK_FILE_REFUSAL.MISSING }),
        onRead: () => {},
      }),
    ),
  );
  assert.match(
    container.querySelector(".file-tab-notice")?.textContent ?? "",
    /no file at this path/u,
  );
  assert.deepEqual(drawnLines(container), [12, 13, 14, 15]);
  assert.deepEqual(litLines(container), [13, 14]);
  const slots = [...container.querySelectorAll(".code-snippet .file-note")].map((note) =>
    note.closest(".diff-note")?.parentElement?.getAttribute("slot"),
  );
  assert.deepEqual(
    slots,
    ["annotation-additions-14", "annotation-additions-15"],
    "a note running past the snippet stands under its last line; one past it stands nowhere",
  );
  assert.ok(container.querySelector("[data-axis] .code-snippet"), "the lines scroll");
});
