// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIMITS,
  type FeedbackKind,
  type FeedbackResult,
} from "@luke/features/feedback";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActPayload } from "@luke/host/contract";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND, type AppCommand } from "@luke/settings/shortcuts";
import { holdExits } from "@luke/ui/testing/held-exits";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { useAppCommand, useMenuCommands } from "./app-commands.js";
import { FeedbackDialog } from "./feedback-dialog.js";
import { fakeActPort, fakeAppBridge } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { holdMotion, releaseMotion } from "./testing/motion-held.js";
import { ToastHost } from "./toast.js";

/** The two Help items that open the dialog, one per kind of note. */
type FeedbackCommand = typeof APP_COMMAND.SEND_FEEDBACK | typeof APP_COMMAND.SUGGEST_FEATURE;

const SIGNED_IN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  name: "Ada Lovelace",
  email: "ada@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
};
/** What the dialog asked the main process to send, and how the next send is answered. */
let sent: PortActPayload<typeof ACT_KIND.FEEDBACK_SEND>[] = [];
let answer: FeedbackResult = { delivered: true };
let menuListener: ((command: AppCommand) => void) | undefined;

beforeEach(() => {
  sent = [];
  answer = { delivered: true };
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.FEEDBACK_SEND]: (payload) => {
      sent.push(payload);
      return Promise.resolve(answer);
    },
  });
  fakeAppPlatform({
    ...QUIET_PANEL,
    onMenuCommand: (listener: (command: AppCommand) => void) => {
      menuListener = listener;
      return () => {
        menuListener = undefined;
      };
    },
  });
});

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  releaseMotion();
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

/** The dialog, wired the way the app wires it to the menu bar's Help items. */
function Harness({ account }: { account: AccountSnapshot }): React.JSX.Element {
  const [kind, setKind] = useState<FeedbackKind>();
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => setKind(FEEDBACK_KIND.FEEDBACK));
  useAppCommand(APP_COMMAND.SUGGEST_FEATURE, () => setKind(FEEDBACK_KIND.PROMPT));
  useMenuCommands(true);
  return createElement(
    Fragment,
    null,
    createElement(FeedbackDialog, { kind, account, onClose: () => setKind(undefined) }),
    createElement(ToastHost),
  );
}

function mount(account: AccountSnapshot = SIGNED_IN): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // Each surface holds its own atoms, so a toast one test raised is not the next one's.
  const registry = AtomRegistry.make();
  registries.push(registry);
  act(() => root.render(onRegistry(registry, createElement(Harness, { account }))));
}

function button(name: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  assert.ok(found, `a button named ${name}`);
  return found;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

/** Help's item for this kind of note, chosen, and the dialog it opened. */
function openFromHelp(command: FeedbackCommand): HTMLElement {
  act(() => menuListener?.(command));
  const opened = dialog();
  assert.ok(opened, `${command} opens the dialog`);
  return opened;
}

function field(): HTMLTextAreaElement {
  const found = dialog()?.querySelector("textarea");
  assert.ok(found, "the dialog draws its field");
  return found;
}
test("each of Help's items opens the dialog of its own kind, with the field taking the keyboard", () => {
  mount();

  const feedback = openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  assert.equal(feedback.querySelector("h2")?.textContent, "Send feedback");
  assert.equal(document.activeElement, field());
  assert.equal(field().placeholder, "What happened, and what did you expect?");
  assert.ok(
    field().closest(".ph-no-capture")?.contains(feedback.querySelector('input[type="checkbox"]')) ??
      false,
    "the note and its signature are left out of the screen recording",
  );

  act(() => button("Cancel").click());
  const prompt = openFromHelp(APP_COMMAND.SUGGEST_FEATURE);
  assert.equal(prompt.querySelector("h2")?.textContent, "Suggest a feature");
});

test("opened from an experiment's row, the dialog is titled for it and its note names the experiment", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  registries.push(registry);
  act(() =>
    root.render(
      onRegistry(
        registry,
        createElement(FeedbackDialog, {
          kind: FEEDBACK_KIND.FEEDBACK,
          about: EXPERIMENT.CHAT,
          account: SIGNED_IN,
          onClose: () => undefined,
        }),
      ),
    ),
  );

  assert.equal(dialog()?.querySelector("h2")?.textContent, "Feedback on Chat");
  // React reads a typed value off the element's own setter, as a keystroke sets it.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field(), "The board missed a plan.");
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Send").click());

  assert.deepEqual(sent[0], {
    submission: {
      kind: FEEDBACK_KIND.FEEDBACK,
      message: "The board missed a plan.",
      name: SIGNED_IN.name,
      email: SIGNED_IN.email,
      images: [],
      experiment: EXPERIMENT.CHAT,
    },
  });
});

test("a note kept from one experiment's row is not sent under another place's title", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const draw = (about: typeof EXPERIMENT.CHAT | undefined) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(FeedbackDialog, {
            kind: FEEDBACK_KIND.FEEDBACK,
            about,
            account: SIGNED_IN,
            onClose: () => undefined,
          }),
        ),
      ),
    );

  draw(EXPERIMENT.CHAT);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field(), "The board missed a plan.");
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(field().value, "The board missed a plan.");

  // The same dialog, now opened from Help about no experiment.
  draw(undefined);
  assert.equal(dialog()?.querySelector("h2")?.textContent, "Send feedback");
  assert.equal(field().value, "");
});

/** Writes `words` into the field, as typing does. */
function write(words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field(), words);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Escape pressed on whatever holds focus. */
function pressEscape(): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

test("a note being written is nudged rather than closed by the first Escape, closed by the next, and kept for the next opening", () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  write("The board missed a plan.");
  pressEscape();
  const nudged = dialog()?.getAttribute("data-nudge");
  pressEscape();
  const closed = dialog() === null;
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);

  assert.equal(nudged, "true", "the first Escape nudges the card and keeps it");
  assert.equal(closed, true, "the second closes it");
  assert.equal(field().value, "The board missed a plan.");
});

/** The counter the field's label line draws once the words near the cap, or nothing before. */
function counter(): string | null {
  return dialog()?.querySelector(".luke-length-counter")?.textContent ?? null;
}

/** Pastes `text` into the field, as the clipboard does. */
function paste(text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [], getData: () => text } });
  act(() => {
    field().dispatchEvent(event);
  });
}

test("the field counts its words from four fifths of its cap, and says nothing before", () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  const limit = FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH;

  write("x".repeat(limit * 0.8 - 1));
  assert.equal(counter(), null);

  write("x".repeat(limit * 0.8));
  assert.equal(counter(), `${String(limit * 0.8)}/${String(limit)}`);
});

test("a paste past the cap says it was cut until the words change", () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  const limit = FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH;
  const note = `Your paste was cut to fit the ${limit.toLocaleString("en-US")}-character limit.`;

  write("x".repeat(limit - 3));
  paste("a short one");
  assert.equal(dialog()?.textContent?.includes(note), false);
  paste("yyyy");
  assert.equal(
    dialog()?.textContent?.includes(note),
    false,
    "the note waits for the words the paste leaves",
  );

  // The browser keeps the room that was left, which is what the note is about.
  write(`${"x".repeat(limit - 3)}yyy`);
  assert.equal(dialog()?.textContent?.includes(note), true);

  write("x".repeat(limit - 4));
  assert.equal(dialog()?.textContent?.includes(note), false);
});

test("Cancel closes the card and keeps the note for the next opening", () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  write("The board missed a plan.");
  act(() => button("Cancel").click());
  const closed = dialog() === null;
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);

  assert.equal(closed, true, "Cancel closes the card");
  assert.equal(field().value, "The board missed a plan.");
});

test("an empty note is closed by the first Escape", () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  pressEscape();
  assert.equal(dialog(), null);
});

test("a refused send says why and keeps the note, and Enter in the note, unlike Shift+Enter, sends it again", async () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field(), "The board missed a plan.");
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });

  answer = { delivered: false };
  await act(async () => button("Send").click());
  assert.equal(
    dialog()?.querySelector('[role="alert"]')?.textContent,
    "Could not send that. Try again.",
  );
  assert.equal(field().value, "The board missed a plan.");

  answer = { delivered: true };
  const press = (init: KeyboardEventInit) =>
    act(async () => {
      field().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }),
      );
    });
  await press({ shiftKey: true });
  assert.equal(sent.length, 1, "Shift+Enter sends nothing");
  await press({});
  assert.equal(dialog(), null);
  assert.equal(sent.length, 2, "the kept note went again");
});

test("a note sent fades out still drawn, in its ending state and with its words and title on it, then goes", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  write("The board missed a plan.");

  await act(async () => button("Send").click());
  const fading = dialog();
  const words = fading?.querySelector("textarea")?.value;
  const title = fading?.querySelector("h2")?.textContent;
  act(() => vi.advanceTimersToNextFrame());
  await act(async () => exits.finish());

  assert.ok(fading, "the card stands while it fades");
  assert.equal(words, "The board missed a plan.", "the words do not vanish mid-fade");
  assert.equal(title, "Send feedback");
  assert.equal(dialog(), null, "it goes once its fade has run");
});

test("a note sent takes its card away at once where motion is held", async () => {
  holdExits();
  holdMotion();
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  write("The board missed a plan.");

  await act(async () => button("Send").click());

  assert.equal(dialog(), null);
});
