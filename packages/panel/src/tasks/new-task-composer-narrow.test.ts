// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import { TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout, typeInComposer } from "../testing/composer.js";
import { layContainersAt, shown } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE, type MentionMenuSide } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";

/**
 * New task's card on a phone's screen: where it stands on Home, at the top
 * of its page, its `@` and `/` lists open under the caret's line, since a
 * list risen over the card is cut off under the page's head, while the
 * dialog's card keeps them over it; and a card too narrow for every press
 * has its Plan toggle and File for later draw their marks alone, still named
 * and still pressed, its microphone stand in the row in place of a ⋯ that
 * would hold it alone, and its model chip's words give way, so the round
 * Start stands inside the card, at the row's end. jsdom lays nothing out, so the
 * card's width is its form's, given as the window would lay it, and what is
 * drawn at a width is the stylesheets' container queries resolved for a card
 * that wide (`testing/container-width.ts`). Synthetic throughout.
 */

/** The card's width: Home's on a 360px phone, and the dialog's on a desktop. */
const CARD = {
  PHONE: 312,
  DESKTOP: 720,
} as const;

/** The Plan toggle's name, which its tooltip says too. */
const MODE_TOGGLE = "Plan with Luke first";

const roots: Root[] = [];

// Landed before any card renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The card on a repository, its lists opening under the line as Home's do, or over it as the dialog's do. */
async function mount(listSide: MentionMenuSide = MENTION_MENU_SIDE.BELOW): Promise<HTMLElement> {
  const control = tasksControl();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaceId: "workspace-acme",
            repositoriesIn: () => ({ ...control.repositories, recent: ["acme/web"] }),
          },
          workspaceId: "workspace-acme",
          onLeave: () => undefined,
          listSide,
        }),
      ),
    ),
  );
  await settle();
  return container;
}

/** Where a list opened in the card stands against the caret's line: over it where its foot is set from the line, under it where its top is. */
function sideOf(list: HTMLElement): "below" | "above" {
  if (list.style.bottom !== "") return "above";
  assert.match(list.style.top, /px$/u, "a list under the line sets its top from it");
  return "below";
}

/** The list a word typed at the start of the box opens, by its class. */
async function listOpenedBy(container: HTMLElement, word: string, list: string) {
  typeInComposer(container, word);
  await settle();
  return container.querySelector<HTMLElement>(list) ?? assert.fail(`${word} opens its list`);
}

test("on Home the @ list opens under the caret's line, where the page's head cannot cut it off", async () => {
  const container = await mount();
  assert.equal(sideOf(await listOpenedBy(container, "@", ".mention-menu")), "below");
});

test("on Home the / list opens under the caret's line too", async () => {
  const container = await mount();
  assert.equal(sideOf(await listOpenedBy(container, "/", ".skill-menu")), "below");
});

test("in the dialog, whose card is not at a page's top, the @ list still opens over the line", async () => {
  const container = await mount(MENTION_MENU_SIDE.ABOVE);
  assert.equal(sideOf(await listOpenedBy(container, "@", ".mention-menu")), "above");
});

test("in the dialog the / list still opens over the line too", async () => {
  const container = await mount(MENTION_MENU_SIDE.ABOVE);
  assert.equal(sideOf(await listOpenedBy(container, "/", ".skill-menu")), "above");
});

/** The toggle that turns Plan mode on, as the card draws it. */
function modeToggle(container: HTMLElement): HTMLButtonElement {
  return (
    container.querySelector<HTMLButtonElement>(`button[aria-label="${MODE_TOGGLE}"]`) ??
    assert.fail("the Plan toggle stands")
  );
}

test("on a phone-wide card the Plan toggle draws its pencil alone, keeps its name, and still turns Plan mode on and off", async () => {
  vi.spyOn(HTMLFormElement.prototype, "clientWidth", "get").mockReturnValue(CARD.PHONE);
  layContainersAt({ composer: CARD.PHONE }, { touch: true });
  const container = await mount();
  const toggle = modeToggle(container);
  const word = toggle.querySelector(".luke-chip-name") ?? assert.fail("the toggle holds its word");

  assert.equal(getComputedStyle(word).width, "1px", "its word is drawn nowhere");
  assert.equal(shown(toggle.querySelector("svg") ?? assert.fail("it holds its pencil")), true);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  act(() => toggle.click());
  assert.equal(modeToggle(container).getAttribute("aria-pressed"), "true");
});

test("on a desktop-wide card the Plan toggle says Plan beside its pencil", async () => {
  vi.spyOn(HTMLFormElement.prototype, "clientWidth", "get").mockReturnValue(CARD.DESKTOP);
  layContainersAt({ composer: CARD.DESKTOP });
  const container = await mount();
  const word =
    modeToggle(container).querySelector(".luke-chip-name") ??
    assert.fail("the toggle holds its word");
  assert.equal(shown(word), true);
  assert.notEqual(getComputedStyle(word).width, "1px", "its word is drawn");
  assert.equal(word.textContent, "Plan");
});

test("on a phone-wide card the placeholder wraps in the card's five lines rather than being cut short, and stays one line on a desktop", async () => {
  const placeholder = async (width: number) => {
    const sheet = layContainersAt({ composer: width });
    const container = await mount();
    const drawn =
      container.querySelector(".agent-composer-placeholder") ?? assert.fail("the box is empty");
    const wraps = getComputedStyle(drawn).whiteSpace;
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    window.localStorage.clear();
    sheet.remove();
    return wraps;
  };
  assert.equal(await placeholder(CARD.PHONE), "normal");
  assert.equal(await placeholder(CARD.DESKTOP), "nowrap");
});

/** The model the account runs by default, whose name the chip draws. */
const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
];
const DEFAULT_CHOICE: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" };

/** The workspace's Linear issues, the first of which the card links. */
const ISSUES: readonly LinearIssueSummary[] = [
  {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Restack the deploy queue",
    url: "https://linear.app/acme/issue/ENG-1",
    state: "Todo",
  },
];

/**
 * Home's card at a width, with every chip chosen: its repository, the
 * account's model, and a Linear issue picked from the Issue chip, and words
 * typed, so Start and File for later both stand ready. Answers the card and
 * the statuses each start asked for.
 */
async function mountChosen(width: number, touch: boolean) {
  vi.spyOn(HTMLFormElement.prototype, "clientWidth", "get").mockReturnValue(width);
  layContainersAt({ composer: width }, { touch });
  const control = tasksControl();
  const statuses: (TaskStatus | undefined)[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaceId: "workspace-acme",
            repositoriesIn: () => ({ ...control.repositories, recent: ["acme/web"] }),
            models: MODELS,
            readDefault: () => Promise.resolve({ choice: DEFAULT_CHOICE }),
            linearIssuesIn: () => () => Promise.resolve(ISSUES),
            start: (_name, _repository, _workspace, _withCall, from) => {
              statuses.push(from?.status);
              return Promise.resolve(undefined);
            },
          },
          workspaceId: "workspace-acme",
          onLeave: () => undefined,
          listSide: MENTION_MENU_SIDE.BELOW,
        }),
      ),
    ),
  );
  await settle();
  const chip =
    container.querySelector<HTMLButtonElement>('[aria-label="Choose an issue"]') ??
    assert.fail("the Issue chip stands");
  act(() => chip.click());
  await settle();
  const search =
    document.querySelector<HTMLInputElement>('input[aria-label^="Search issues"]') ??
    assert.fail("the Issue chip's search is open");
  act(() => {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
  assert.ok(container.textContent?.includes("ENG-1"), "the issue is linked over the words");
  typeInComposer(container, "Reproduce it first.");
  await settle();
  return { container, statuses };
}

/** The presses drawn along the foot's right-hand row, in the order they stand, each by its name. */
function rowPresses(container: HTMLElement): readonly HTMLButtonElement[] {
  const row =
    container.querySelector(".agent-composer-actions") ?? assert.fail("the foot's row stands");
  return [...row.querySelectorAll<HTMLButtonElement>("button")].filter(shown);
}

function nameOf(press: HTMLButtonElement): string {
  return press.getAttribute("aria-label") ?? press.textContent?.trim() ?? "";
}

/** Whether a press draws words of its own, rather than a mark alone named by its label. */
function drawsWords(press: HTMLButtonElement): boolean {
  const name = press.querySelector(".luke-chip-name");
  if (name !== null) return getComputedStyle(name).width !== "1px";
  return (press.textContent?.trim() ?? "") !== "";
}

test("on a phone-wide card with every chip chosen, Start stands last in the row, every press beside it but the model drawing its mark alone, and no ⋯ holding a single press", async () => {
  const { container } = await mountChosen(CARD.PHONE, true);
  const presses = rowPresses(container);

  assert.deepEqual(presses.map(nameOf), [
    MODE_TOGGLE,
    "Opus 5.5 High",
    "Dictate",
    "File for later",
    "Start agent",
  ]);
  assert.deepEqual(
    presses.filter(drawsWords).map(nameOf),
    ["Opus 5.5 High"],
    "only the model chip draws words, which are what give way",
  );
  assert.equal(presses.at(-1)?.disabled, false, "Start stands ready");
});

test("on a desktop-wide card with every chip chosen, the row reads as it always has: Plan and File for later in words, the microphone, and Start", async () => {
  const { container } = await mountChosen(CARD.DESKTOP, false);
  const presses = rowPresses(container);

  assert.deepEqual(presses.map(nameOf), [
    MODE_TOGGLE,
    "Opus 5.5 High",
    "Dictate",
    "File for later",
    "Start agent",
  ]);
  assert.deepEqual(presses.filter(drawsWords).map(nameOf), [
    MODE_TOGGLE,
    "Opus 5.5 High",
    "File for later",
  ]);
});

test("on a phone-wide card File for later draws the backlog's mark alone, keeps its name, and still files the task in the backlog", async () => {
  const { container, statuses } = await mountChosen(CARD.PHONE, true);
  const file =
    rowPresses(container).find((press) => press.getAttribute("aria-label") === "File for later") ??
    assert.fail("File for later is named");

  assert.equal(drawsWords(file), false, "its words are drawn nowhere");
  assert.ok(file.querySelector(".luke-task-status-mark"), "it draws the backlog's mark");
  act(() => file.click());
  await settle();
  assert.deepEqual(statuses, [TASK_STATUS.BACKLOG]);
});
