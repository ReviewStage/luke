// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "@luke/features/shown-failure";
import { STATUS_TONE } from "@luke/ui";
import { Duration } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { installShownFailureReporter } from "./failure-report.js";
import { onRegistry } from "./testing/copy-feedback.js";
import {
  TOAST_HOLD,
  ToastHost,
  type ToastNotice,
  undoToast,
  useToast,
  useWorkingToast,
} from "./toast.js";

/**
 * toast.test.ts -- the window's toasts against the window they stand in: a
 * window too short for three stands two, setting the oldest aside until
 * there is room again; one whose hold runs down with an action draws that
 * hold as its countdown; work under way settles into its own card in
 * place; an act's Undo toast takes the act back and stands for the Undo
 * hold; and a failure toast reports what failed to Sentry, which a recording
 * SDK stands in for. jsdom lays nothing out, so the window's height is given. Synthetic
 * throughout.
 */

/** The window's heights: its least, and one with room for three toasts. */
const WINDOW = {
  SHORT: 520,
  TALL: 800,
} as const;

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;
let show: ((notice: ToastNotice) => void) | undefined;
let work: ((words: string) => (notice: ToastNotice) => void) | undefined;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  registry?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Hands the test the window's way of showing a toast. */
function Shower(): null {
  show = useToast();
  work = useWorkingToast();
  return null;
}

/** The toasts, mounted as the window's root mounts them, in a window `height` tall. */
function mount(height: number): void {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() =>
    root?.render(
      onRegistry(
        held,
        createElement(Fragment, null, createElement(Shower), createElement(ToastHost)),
      ),
    ),
  );
}

/** A toast that stands until it is dismissed, as an agent's end does. */
function persisting(words: string): ToastNotice {
  return {
    words,
    tone: STATUS_TONE.COMPLETE,
    action: { label: "View", onPress: () => undefined },
    persists: true,
  };
}

/** What each toast standing says, oldest first, leaving out those on their way out. */
function standing(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

/** Lets `ms` pass on the faked clock the toasts' holds run down on. */
function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The button a standing toast labels `label`. */
function toastButton(label: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(".luke-toast:not([data-leaving]) button"),
  ].find((button) => button.textContent === label);
  return found ?? assert.fail(`a toast button named ${label}`);
}

/** The window grown or shrunk to `height`, as a drag of its edge reports it. */
function resizeTo(height: number): void {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
  act(() => window.dispatchEvent(new Event("resize")));
}

test("a window too short for three toasts stands the two newest, and the one set aside stands again once the window is tall enough", () => {
  mount(WINDOW.SHORT);

  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Should withdrawn invitations count?")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  const short = standing();
  resizeTo(WINDOW.TALL);

  assert.deepEqual(short, [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
  ]);
  assert.deepEqual(standing(), [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
    "Retry the webhook finished",
  ]);
});

test("a window made too short for three toasts sets the oldest aside, without dismissing it", () => {
  mount(WINDOW.TALL);
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Should withdrawn invitations count?")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  const tall = standing();

  resizeTo(WINDOW.SHORT);
  const short = standing();
  resizeTo(WINDOW.TALL);

  assert.equal(tall.length, 3);
  assert.deepEqual(short, [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
  ]);
  assert.ok(standing().includes("Retry the webhook finished"), "the toast set aside comes back");
});

test("a toast with an action carries a Dismiss button the keyboard reaches, and its press or Escape from it sends the toast away", () => {
  mount(WINDOW.TALL);
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  const dismissButtons = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(".luke-toast:not([data-leaving]) button"),
    ].filter((button) => button.getAttribute("aria-label") === "Dismiss");

  const [first, second] = dismissButtons();
  assert.ok(first && second);
  act(() => first.click());
  const afterPress = standing();
  act(() => second.focus());
  const focused = document.activeElement === second;
  act(() => {
    second.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  assert.deepEqual(afterPress, ["Nightly upgrade couldn't start"]);
  assert.ok(focused, "the Dismiss button takes focus");
  assert.deepEqual(standing(), []);
});

test("a phone's keyboard rising in a tall window leaves room for two toasts, setting the oldest aside until it goes down", () => {
  const seen: EventTarget & { height: number } = Object.assign(new EventTarget(), {
    offsetTop: 0,
    offsetLeft: 0,
    width: 390,
    height: WINDOW.TALL,
  });
  vi.stubGlobal("visualViewport", seen);
  mount(WINDOW.TALL);
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Should withdrawn invitations count?")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));

  seen.height = WINDOW.SHORT;
  act(() => seen.dispatchEvent(new Event("resize")));
  const keyboardUp = standing();
  seen.height = WINDOW.TALL;
  act(() => seen.dispatchEvent(new Event("resize")));

  assert.deepEqual(keyboardUp, [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
  ]);
  assert.equal(standing().length, 3);
});

test("two pieces of work under way stand apart, each settles its own card in place, and a refusal is said as an alert", () => {
  mount(WINDOW.TALL);
  let first: ((notice: ToastNotice) => void) | undefined;
  let second: ((notice: ToastNotice) => void) | undefined;
  act(() => {
    first = work?.("Saving…");
    second = work?.("Saving…");
  });
  const working = [...document.querySelectorAll(".luke-toast")];

  act(() =>
    second?.({
      words: "Couldn't save",
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: { surface: FAILURE_SURFACE.PLAN_SAVE, cause: FAILURE_CONDITION.NOT_KEPT },
    }),
  );
  act(() => first?.({ words: "Saved", tone: STATUS_TONE.COMPLETE, hold: TOAST_HOLD.DONE }));

  assert.deepEqual(standing(), ["Saved", "Couldn't save"]);
  assert.deepEqual([...document.querySelectorAll(".luke-toast")], working, "the same two cards");
  assert.equal(document.querySelector('[role="alert"]')?.textContent, "Couldn't save");
});

test("a failure toast reports what failed: an unexpected one as an error line and an issue grouped by where and what, credentials redacted, and a refusal as a warning line alone", () => {
  mount(WINDOW.TALL);
  const issues: { error: Error; hint: unknown }[] = [];
  const lines: { level: string; message: string; attributes: unknown }[] = [];
  const recording: ShownFailureSentry = {
    captureException: (error, hint) => {
      issues.push({ error, hint });
      return "";
    },
    logger: {
      warn: (message, attributes) => lines.push({ level: "warn", message, attributes }),
      error: (message, attributes) => lines.push({ level: "error", message, attributes }),
    },
  };
  const uninstall = installShownFailureReporter((report) => sendShownFailure(recording, report));
  // A credential in the cause's code as well as its message, since a code is sent as a tag and grouped by.
  const unreached = Object.assign(new TypeError("fetch failed with token=fixture-secret"), {
    status: 503,
    code: "sk-fixturecode01",
  });

  act(() =>
    show?.({
      words: "The agent could not be stopped.",
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: {
        surface: FAILURE_SURFACE.AGENT_STOP,
        cause: new Error("Luke didn't hear back.", { cause: unreached }),
        about: { agentId: "agent-fixture" },
      },
    }),
  );
  act(() =>
    show?.({
      words: "Messages are limited to 20,000 characters.",
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: {
        surface: FAILURE_SURFACE.AGENT_START,
        cause: { status: "rejected", reason: "Messages are limited to 20,000 characters." },
        about: { agentId: "agent-fixture" },
      },
    }),
  );
  uninstall();

  // A window whose document is not read yet says it is online and its account unread.
  const unexpected = {
    "failure.surface": "agent.stop",
    "failure.kind": "unexpected",
    "failure.code": "[redacted]",
    "error.name": "Error",
    "error.message": "Luke didn't hear back.",
    "error.root.name": "TypeError",
    "error.root.code": "[redacted]",
    "error.root.status": 503,
    "error.root.message": "fetch failed with [redacted]",
    "agent.id": "agent-fixture",
    "app.online": true,
    "app.account": "unread",
  };
  assert.deepEqual(lines, [
    {
      level: "error",
      message: "A failure was shown on agent.stop: [redacted]",
      attributes: unexpected,
    },
    {
      level: "warn",
      message: "A failure was shown on agent.start: rejected",
      attributes: {
        "failure.surface": "agent.start",
        "failure.kind": "refused",
        "failure.code": "rejected",
        "error.code": "rejected",
        "error.message": "Messages are limited to 20,000 characters.",
        "agent.id": "agent-fixture",
        "app.online": true,
        "app.account": "unread",
      },
    },
  ]);
  assert.equal(issues.length, 1, "the refusal opens no issue");
  const [issue] = issues;
  assert.deepEqual(issue?.hint, {
    mechanism: { type: "auto.luke.shown_failure", handled: true },
    captureContext: {
      level: "error",
      fingerprint: ["shown-failure", "agent.stop", "[redacted]"],
      tags: {
        "failure.surface": "agent.stop",
        "failure.code": "[redacted]",
        "agent.id": "agent-fixture",
      },
      contexts: { shown_failure: unexpected },
    },
  });
  assert.equal(issue?.error.message, "Luke didn't hear back.");
  // Sentry reads the causes beneath an issue's error too, so they go redacted, their frames among them.
  const beneath = issue?.error.cause;
  assert.ok(beneath instanceof Error);
  assert.equal(beneath.name, "TypeError");
  assert.equal(beneath.message, "fetch failed with [redacted]");
  assert.ok(!beneath.stack?.includes("fixture-secret"));
});

test("an Undo toast says the act in the success tone, and its Undo takes the act back and sends the toast away", () => {
  mount(WINDOW.TALL);
  const undone: string[] = [];
  act(() => show?.(undoToast("Task archived", () => undone.push("Task archived"))));

  act(() => toastButton("Undo").click());

  assert.deepEqual(undone, ["Task archived"]);
  assert.deepEqual(standing(), []);
});

test("an Undo toast nobody points at stands for the Undo hold, then leaves without taking the act back", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  mount(WINDOW.TALL);
  const hold = Duration.toMillis(TOAST_HOLD.UNDO);
  const undone: string[] = [];
  act(() => show?.(undoToast("Settings reset", () => undone.push("Settings reset"))));

  pass(hold - 1);
  const justBefore = standing();
  pass(1);

  assert.deepEqual(justBefore, ["Settings reset"]);
  assert.deepEqual(standing(), []);
  assert.deepEqual(undone, []);
});
