// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { builtStylesheet, cssRules } from "#testing/css-rules";
import {
  TOAST_HOLD,
  TOAST_TONE,
  ToastHost,
  type ToastNotice,
  useToast,
  useWithdrawToast,
} from "./toast";

/** The window's toasts beside a probe that hands back their show and withdraw. */
function mount(registry: AtomRegistry) {
  let show: ((notice: ToastNotice) => void) | undefined;
  let withdraw: ((subject: string) => void) | undefined;
  function Probe() {
    show = useToast();
    withdraw = useWithdrawToast();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const surface = createElement(Fragment, null, createElement(Probe), createElement(ToastHost));
  act(() => createRoot(container).render(onRegistry(registry, surface)));
  return {
    show: (notice: ToastNotice) => {
      assert.ok(show);
      act(() => show?.(notice));
    },
    withdraw: (subject: string) => {
      assert.ok(withdraw);
      act(() => withdraw?.(subject));
    },
  };
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

/** Advances the clock the toasts' holds wait on, then lets what fell due land. */
const advance = (millis: number) =>
  Effect.andThen(TestClock.adjust(Duration.millis(millis)), landed);

/** What each toast standing says, top to bottom, those on their way out included. */
function toasts(): (string | null)[] {
  return [...document.querySelectorAll(".toast")].map((toast) => toast.textContent);
}

/** What the window's toast says, while exactly one stands. */
function toast(): string | undefined {
  const shown = toasts();
  assert.ok(shown.length <= 1, `more than one toast: ${shown.join(" | ")}`);
  return shown[0] ?? undefined;
}

function toastElement(index = 0): HTMLElement {
  const shown = document.querySelectorAll<HTMLElement>(".toast")[index];
  assert.ok(shown, "no toast");
  return shown;
}

function actionButton(index = 0): HTMLButtonElement {
  const button = toastElement(index).querySelector<HTMLButtonElement>("button");
  assert.ok(button, "no action on the toast");
  return button;
}

function dismissButton(index = 0): HTMLButtonElement | null {
  return toastElement(index).querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
}

/** Fires a React-heard event on a toast: the pointer arriving or leaving, focus coming or going. */
function toastEvent(type: "pointerover" | "pointerout" | "focusin" | "focusout", index = 0): void {
  const target = toastElement(index);
  act(() => {
    target.dispatchEvent(
      type === "focusin" || type === "focusout"
        ? new FocusEvent(type, { bubbles: true })
        : new PointerEvent(type, { bubbles: true }),
    );
  });
}

/** What the polite region and the alert say aloud. */
function spoken() {
  return {
    status: document.querySelector('[role="status"]')?.textContent,
    alert: document.querySelector('[role="alert"]')?.textContent,
  };
}

/** An agent's end, as the window says it: standing until dismissed, waiting for room. */
const ended = (words: string, subject = words): ToastNotice => ({
  words,
  tone: TOAST_TONE.DONE,
  waits: true,
  persists: true,
  subject,
  action: { label: "View", onPress: () => undefined },
});

const copied: ToastNotice = { words: "Copied plan", tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE };

afterEach(() => {
  document.body.innerHTML = "";
});

it.effect(
  "a toast with an action stands five seconds, and pressing its action runs it once and sends the toast away",
  () =>
    Effect.gen(function* () {
      const { show } = mount(yield* registryOnTestClock);
      const undone: string[] = [];
      show({
        words: "Plan archived",
        tone: TOAST_TONE.DONE,
        action: { label: "Undo", onPress: () => undone.push("undo") },
      });
      yield* landed;
      assert.equal(toast(), "Plan archivedUndo");
      assert.equal(dismissButton(), null, "one that leaves by itself offers no ×");
      yield* advance(4_999);
      assert.equal(toast(), "Plan archivedUndo");
      yield* advance(1 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined, "gone once its hold and its exit have passed");

      show({
        words: "Plan archived",
        tone: TOAST_TONE.DONE,
        action: { label: "Undo", onPress: () => undone.push("undo") },
      });
      yield* landed;
      act(() => actionButton().click());
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.deepEqual(undone, ["undo"]);
      assert.equal(toast(), undefined);
    }),
);

it.effect(
  "a toast with an action holds while the pointer is over it or focus is in it, and runs down what was left once both are gone",
  () =>
    Effect.gen(function* () {
      const { show } = mount(yield* registryOnTestClock);
      show({
        words: "Voice settings reset",
        tone: TOAST_TONE.DONE,
        action: { label: "Undo", onPress: () => undefined },
      });
      yield* landed;
      yield* advance(2_000);
      toastEvent("pointerover");
      yield* advance(60_000);
      assert.equal(toast(), "Voice settings resetUndo", "held while pointed at");

      toastEvent("focusin");
      toastEvent("pointerout");
      yield* advance(60_000);
      assert.equal(toast(), "Voice settings resetUndo", "held while focus is in it");

      toastEvent("focusout");
      yield* advance(2_999);
      assert.equal(toast(), "Voice settings resetUndo", "the three seconds left run down");
      yield* advance(1 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined);
    }),
);

it.effect(
  "a refusal stands six seconds and offers no button, and toasts stack newest at the bottom, each on its own hold",
  () =>
    Effect.gen(function* () {
      const { show } = mount(yield* registryOnTestClock);
      show({
        words: "The plan could not be archived. Try again.",
        tone: TOAST_TONE.FAILED,
        hold: TOAST_HOLD.FAILED,
      });
      yield* landed;
      assert.equal(document.querySelector(".toast button"), null);
      yield* advance(3_000);
      show({
        words: "Plan deleted",
        detail: "Team invites",
        tone: TOAST_TONE.DONE,
        hold: TOAST_HOLD.DONE,
      });
      yield* landed;
      assert.deepEqual(toasts(), [
        "The plan could not be archived. Try again.",
        "Plan deletedTeam invites",
      ]);
      assert.equal(toastElement(1).querySelector(".toast-detail")?.textContent, "Team invites");

      yield* advance(2_999);
      assert.equal(toasts().length, 2, "the refusal outlasts four seconds");
      yield* advance(1 + MOTION_DURATION_MS.EXIT);
      assert.deepEqual(toasts(), [], "each gone at its own hold's end");
    }),
);

it.effect(
  "a fourth toast pushes out the oldest that would leave by itself, and one saying what another already says takes its place",
  () =>
    Effect.gen(function* () {
      const { show } = mount(yield* registryOnTestClock);
      show(ended("Opus 5.5 finished"));
      show(copied);
      show({ words: "Plan deleted", tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      yield* landed;
      show({ words: "Plan renamed", tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.deepEqual(
        toasts(),
        ["Opus 5.5 finishedView", "Plan deleted", "Plan renamed"],
        "the copy goes, not the agent's end that would stand until dismissed",
      );

      yield* advance(2_000);
      show({ words: "Plan deleted", tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      yield* landed;
      assert.deepEqual(toasts(), ["Opus 5.5 finishedView", "Plan renamed", "Plan deleted"]);
      yield* advance(1_000 + MOTION_DURATION_MS.EXIT);
      assert.deepEqual(
        toasts(),
        ["Opus 5.5 finishedView", "Plan deleted"],
        "the twin's hold started afresh",
      );
    }),
);

it.effect(
  "a toast passing through a stack of three that persist steps the oldest aside, and it stands again once there is room",
  () =>
    Effect.gen(function* () {
      const { show } = mount(yield* registryOnTestClock);
      show(ended("Opus 5.5 finished"));
      show(ended("GPT 5.6 Sol finished"));
      show(ended("Fix invitations failed"));
      yield* landed;
      show(copied);
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.deepEqual(toasts(), [
        "GPT 5.6 Sol finishedView",
        "Fix invitations failedView",
        "Copied plan",
      ]);

      yield* advance(Duration.toMillis(TOAST_HOLD.DONE));
      assert.deepEqual(
        toasts(),
        ["GPT 5.6 Sol finishedView", "Fix invitations failedView", "Opus 5.5 finishedView"],
        "the agent's end is back once the copy has gone",
      );
    }),
);

it.effect(
  "a toast that persists outlasts every hold until its ×, or Escape while focus is in it, dismisses it",
  () =>
    Effect.gen(function* () {
      const { show } = mount(yield* registryOnTestClock);
      show(ended("Opus 5.5 finished"));
      show(ended("GPT 5.6 Sol finished"));
      yield* advance(60_000);
      assert.deepEqual(toasts(), ["Opus 5.5 finishedView", "GPT 5.6 Sol finishedView"]);

      const dismiss = dismissButton(0);
      assert.ok(dismiss, "one that persists offers a ×");
      act(() => dismiss.click());
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.deepEqual(toasts(), ["GPT 5.6 Sol finishedView"]);

      act(() => {
        actionButton().dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.deepEqual(toasts(), []);
    }),
);

it.effect(
  "toasts that wait stand as room is made, and withdrawing a subject takes away its toast whether standing or waiting",
  () =>
    Effect.gen(function* () {
      const { show, withdraw } = mount(yield* registryOnTestClock);
      show(ended("Opus 5.5 finished", "agent-1"));
      show(ended("GPT 5.6 Sol finished", "agent-2"));
      show(ended("Fix invitations failed", "agent-3"));
      show(ended("Audit export finished", "agent-4"));
      show(ended("Retry webhooks finished", "agent-5"));
      yield* landed;
      assert.deepEqual(toasts(), [
        "Opus 5.5 finishedView",
        "GPT 5.6 Sol finishedView",
        "Fix invitations failedView",
      ]);

      withdraw("agent-4");
      withdraw("agent-2");
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.deepEqual(toasts(), [
        "Opus 5.5 finishedView",
        "Fix invitations failedView",
        "Retry webhooks finishedView",
      ]);
    }),
);

it.effect(
  "what each toast says reaches regions mounted before it, a refusal as an alert, the second line spoken after the words",
  () =>
    Effect.gen(function* () {
      const { show } = mount(yield* registryOnTestClock);
      assert.deepEqual(spoken(), { status: "", alert: "" }, "both regions stand before any toast");

      show({
        words: "Plan deleted",
        detail: "Team invites",
        tone: TOAST_TONE.DONE,
        hold: TOAST_HOLD.DONE,
      });
      yield* landed;
      assert.deepEqual(spoken(), { status: "Plan deleted. Team invites", alert: "" });

      show({ words: "Could not copy", tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      yield* landed;
      assert.deepEqual(spoken(), { status: "Plan deleted. Team invites", alert: "Could not copy" });

      yield* advance(Duration.toMillis(TOAST_HOLD.FAILED) + MOTION_DURATION_MS.EXIT);
      assert.deepEqual(spoken(), { status: "", alert: "" });
    }),
);

test("the toasts stand in the window's very corner, and step up clear of a call bar only while a card with something to press stands over it", async () => {
  const rules = cssRules(await builtStylesheet());
  const stack = rules.find((rule) => rule.selectors.includes(".toast-stack"));
  assert.equal(stack?.declarations.get("right"), "var(--space-16)");
  assert.equal(stack?.declarations.get("bottom"), "var(--space-16)");
  assert.equal(stack?.declarations.has("transform"), false);
  // Nothing at the window's foot moves the corner itself.
  const lifts = rules.filter(
    (rule) =>
      rule.selectors.some((selector) => selector.endsWith(" .toast-stack")) &&
      rule.declarations.has("bottom"),
  );
  assert.deepEqual(lifts, []);
  // The one step: a call bar drawn and a card with an action standing, by the bar's own row.
  const step = rules.find((rule) =>
    rule.selectors.includes(
      'body:has(.desktop-call-bar) .toast-stack:has(.toast[data-action="true"]:not([data-leaving]))',
    ),
  );
  assert.match(step?.declarations.get("transform") ?? "", /var\(--call-row-height\)/);
  assert.match(stack?.declarations.get("transition") ?? "", /^transform var\(--duration-fast\)/);
});
