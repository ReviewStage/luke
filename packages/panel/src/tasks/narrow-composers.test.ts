// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DIALOG_SIZE, Dialog } from "@luke/ui";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout, QUIET_COMPOSER } from "../testing/composer.js";
import { layContainersAt, shown } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { AgentComposer } from "./agent-composer.js";
import { NewTaskDialog } from "./new-task-dialog.js";
import { useAgentComposer } from "./use-agent-composer.js";

/**
 * The composers on a phone's screen, each laid at the width it has there
 * against the width it has on a desktop: with a phone's keyboard up a box's field
 * stops growing at a share of what is seen; a thread opened over a narrow
 * plan spans the column; New task's dialog spends the desktop's margins on
 * its card; the repository menu keeps inside the screen; and the `@` list's
 * foot of keys stands only where there are keys. jsdom lays nothing out and
 * resolves no `var()`, so the stylesheets are laid for each width and device
 * (`testing/container-width.ts`) and a length is read with its custom
 * properties resolved where they are declared, and its arithmetic worked out.
 * Synthetic throughout.
 */

/** Widths as a 390px phone and a desktop's window lay them, in pixels. */
const PHONE = {
  /** The visible height with the keyboard up. */
  STAGE_WITH_KEYBOARD: 508,
  /** A composer's card, the screen less the column's insets. */
  CARD: 342,
  /** What the dimmed window leaves a dialog: the screen less its margins. */
  DIALOG_ROOM: 342,
  SCREEN: 390,
} as const;

/** The Inbox's draft reply's card in a 360px window: the screen less the thread's insets and the reply's face beside it. */
const INBOX_CARD_AT_360 = 288;

const DESKTOP = {
  STAGE: 800,
  CARD: 720,
  DIALOG_ROOM: 1232,
} as const;

const ignore = () => undefined;

const roots: Root[] = [];

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
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-luke-profile");
  document.documentElement.removeAttribute("data-luke-room");
});

/** Draws `node` into the body, under a shell in the room given where one is. */
async function draw(node: ReactElement, room?: "narrow" | "wide"): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  if (room !== undefined) {
    container.className = "desktop-shell";
    container.dataset.room = room;
  }
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), node)));
  return container;
}

/** A custom property as `element` inherits it, or nothing where none is declared. */
function custom(element: Element, name: string): string | undefined {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value === "" ? undefined : value.replace(/\s+/gu, " ");
}

/** A declared value with every `var()` replaced by what `element` inherits for it, or its fallback. */
function resolved(element: Element, value: string): string {
  const next = value.replace(
    /var\((--[\w-]+)(?:,\s*([^()]*))?\)/u,
    (_, name: string, fallback: string | undefined) =>
      custom(element, name) ?? fallback ?? assert.fail(`${name} is declared`),
  );
  return next === value ? value : resolved(element, next);
}

/** A length's pixels: its `var()`s resolved for `element`, and its `calc()`/`min()` worked out over pixels alone. */
function pixels(element: Element, value: string): number {
  const arithmetic = resolved(element, value)
    .replace(/\bcalc\(/gu, "(")
    .replace(/\bmin\(/gu, "Math.min(")
    .replace(/(-?\d*\.?\d+)px/gu, "$1");
  assert.match(arithmetic, /^[\d\s.+\-*/(),Mathmin]+$/u, `${value} is pixels alone`);
  return Number(new Function(`return ${arithmetic};`)());
}

/** The visible height the stage is sized by, as the panel writes it on the root. */
function stageAt(height: number): void {
  document.documentElement.style.setProperty("--luke-stage-height", `${height}px`);
}

/** An agent's box with a few lines in it. */
function AgentBox(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise(ignore),
    onStatus: ignore,
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, composer });
}

test("on a phone with the keyboard up, the agent's field stops growing at under a third of what is seen, short of its eight lines", async () => {
  document.documentElement.setAttribute("data-luke-profile", "web");
  layContainersAt({ composer: PHONE.CARD }, { touch: true });
  stageAt(PHONE.STAGE_WITH_KEYBOARD);
  const container = await draw(createElement(AgentBox), "narrow");
  const field = container.querySelector(".agent-composer-input") ?? assert.fail("the field stands");

  const cap = pixels(field, getComputedStyle(field).maxHeight);
  const lines = pixels(field, custom(field, "--agent-composer-field-lines") ?? "");
  assert.equal(cap, PHONE.STAGE_WITH_KEYBOARD * 0.3);
  assert.ok(cap < lines, "the share of the screen is less than eight lines");
});

test("on a desktop, the agent's field grows to its eight lines whatever the window's height", async () => {
  layContainersAt({ composer: DESKTOP.CARD });
  stageAt(DESKTOP.STAGE);
  const container = await draw(createElement(AgentBox), "wide");
  const field = container.querySelector(".agent-composer-input") ?? assert.fail("the field stands");
  const cap = getComputedStyle(field).maxHeight;
  assert.doesNotMatch(cap, /stage-height|field-cap/u, "the window's height bounds nothing");
  assert.equal(custom(field, "--agent-composer-field-cap"), undefined);
});

/** New task's dialog open, as a press of New task opens it, portalled over the window outside any shell; answers its field. */
async function openNewTask(): Promise<Element> {
  const control = tasksControl();
  await draw(
    createElement(NewTaskDialog, {
      newTask: {
        ...control.newTask,
        open: true,
        workspaceId: "workspace-acme",
        repositoriesIn: () => ({ ...control.repositories, recent: ["acme/web"] }),
      },
    }),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return (
    document.querySelector(".luke-dialog .agent-composer-input") ??
    assert.fail("the dialog's field stands")
  );
}

test("on a phone with the keyboard up, New task's dialog, drawn outside the shell, caps its field at the same share of what is seen", async () => {
  document.documentElement.setAttribute("data-luke-profile", "web");
  document.documentElement.setAttribute("data-luke-room", "narrow");
  layContainersAt({ "luke-dialog-room": PHONE.DIALOG_ROOM, composer: PHONE.CARD }, { touch: true });
  stageAt(PHONE.STAGE_WITH_KEYBOARD);
  const field = await openNewTask();
  assert.equal(pixels(field, getComputedStyle(field).maxHeight), PHONE.STAGE_WITH_KEYBOARD * 0.3);
});

test("on a desktop, New task's dialog lets its field grow to its eight lines whatever the window's height", async () => {
  document.documentElement.setAttribute("data-luke-room", "wide");
  layContainersAt({ "luke-dialog-room": DESKTOP.DIALOG_ROOM, composer: DESKTOP.CARD });
  stageAt(DESKTOP.STAGE);
  const field = await openNewTask();
  assert.doesNotMatch(getComputedStyle(field).maxHeight, /stage-height|field-cap/u);
});

/** A thread opened over a plan's column, as the plan lays it, in the room given. */
function threadIn(room: "narrow" | "wide"): HTMLElement {
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const float = shell.appendChild(document.createElement("div"));
  float.className = "comment-float";
  return float;
}

test("in a narrow room, an open thread spans the plan's column rather than standing a margin card's width at its right", () => {
  layContainersAt({}, { touch: true });
  const float = threadIn("narrow");
  const style = getComputedStyle(float);
  assert.equal(style.width, "auto");
  assert.equal(
    pixels(float, style.left),
    pixels(float, style.right),
    "it overhangs both sides alike",
  );
});

test("in a wide room, an open thread keeps the margin card's width", () => {
  layContainersAt({});
  const float = threadIn("wide");
  assert.equal(pixels(float, getComputedStyle(float).width), 288);
});

/** A composer's dialog card, as New task's stands, under the dimmed window that holds it. */
async function composerDialog(): Promise<HTMLElement> {
  await draw(
    createElement(Dialog, {
      title: "New task",
      size: DIALOG_SIZE.COMPOSER,
      onDismiss: ignore,
      children: null,
    }),
  );
  return document.querySelector<HTMLElement>(".luke-dialog") ?? assert.fail("the card stands");
}

test("on a phone, New task's dialog stands 12px from the screen's edges at a card's snug inset", async () => {
  document.documentElement.setAttribute("data-luke-profile", "web");
  document.documentElement.setAttribute("data-luke-room", "narrow");
  layContainersAt({ "luke-dialog-room": PHONE.DIALOG_ROOM }, { touch: true });
  const dialog = await composerDialog();
  const style = getComputedStyle(dialog);
  // The dimmed window keeps 24px either side; the card reaches half of it back.
  assert.equal(24 + pixels(dialog, style.marginLeft), 12);
  assert.equal(24 + pixels(dialog, style.marginRight), 12);
  assert.equal(pixels(dialog, style.paddingLeft), 12);
  assert.equal(pixels(dialog, style.paddingRight), 12);
});

test("on a desktop, New task's dialog keeps the dimmed window's margins", async () => {
  document.documentElement.setAttribute("data-luke-room", "wide");
  layContainersAt({ "luke-dialog-room": DESKTOP.DIALOG_ROOM });
  const dialog = await composerDialog();
  const style = getComputedStyle(dialog);
  assert.equal(pixels(dialog, style.marginLeft), 0, "it stands within the dimmed window's margins");
  assert.equal(pixels(dialog, style.marginRight), 0);
});

/** The `@` list's foot, which names the keys it hears. */
function mentionFoot(): HTMLElement {
  const menu = document.body.appendChild(document.createElement("div"));
  menu.className = "luke-menu-surface mention-menu";
  const foot = menu.appendChild(document.createElement("div"));
  foot.className = "luke-menu-keys";
  return foot;
}

test("on a touch screen the @ list names no keys at its foot, and with a mouse it does", () => {
  const touch = layContainersAt({}, { touch: true });
  assert.equal(shown(mentionFoot()), false);
  touch.remove();
  document.body.innerHTML = "";

  layContainersAt({});
  assert.equal(shown(mentionFoot()), true);
});

test("a phone on its side, its room narrow though its dimmed window is wide, stands New task's dialog as a phone's", async () => {
  document.documentElement.setAttribute("data-luke-profile", "web");
  document.documentElement.setAttribute("data-luke-room", "narrow");
  layContainersAt({ "luke-dialog-room": 702 }, { touch: true });
  const dialog = await composerDialog();
  assert.equal(24 + pixels(dialog, getComputedStyle(dialog).marginLeft), 12);
});

test("a page that says no room of its own is answered by its dimmed window's width", async () => {
  layContainersAt({ "luke-dialog-room": PHONE.DIALOG_ROOM }, { touch: true });
  const dialog = await composerDialog();
  assert.equal(24 + pixels(dialog, getComputedStyle(dialog).marginLeft), 12);
});

/** The Inbox's answer box as the box lays it (`inbox-answer-box.tsx`): its note line, and under it its foot (`ComposerFoot`) of +, microphone, and Send. */
function inboxBox(): Record<"foot" | "attach" | "line" | "actions" | "mic" | "send", HTMLElement> {
  const part = (parent: Element, tag: string, className: string) => {
    const element = parent.appendChild(document.createElement(tag));
    element.className = className;
    return element;
  };
  const card = part(document.body, "div", "agent-composer");
  const form = part(card, "form", "luke-composer-frame prompt-input inbox-answer");
  const line = part(form, "div", "agent-composer-field");
  part(line, "div", "agent-composer-input");
  const foot = part(part(form, "div", "luke-composer-foot"), "div", "luke-composer-foot-bar");
  const attach = part(part(foot, "div", "luke-composer-foot-tools"), "button", "");
  const actions = part(foot, "div", "luke-composer-foot-end");
  const mic = part(actions, "button", "dictate-button");
  const send = part(actions, "button", "prompt-input-submit");
  return { foot, attach, line, actions, mic, send };
}

test("in a 360px window, the Inbox box keeps its +, its microphone, and Send in one row under its note line, the presses never giving way", () => {
  layContainersAt({ composer: INBOX_CARD_AT_360 }, { touch: true });
  const { foot, attach, line, actions, mic, send } = inboxBox();
  assert.deepEqual([line, attach, mic, send].map(shown), [true, true, true, true]);
  assert.equal(getComputedStyle(foot).flexWrap, "nowrap", "one row");
  assert.equal(getComputedStyle(actions).flexShrink, "0", "the microphone and Send never give way");
  const input = line.querySelector(".agent-composer-input") ?? assert.fail("the line's input");
  assert.equal(getComputedStyle(input).width, "100%", "the note line spans the card");
});
