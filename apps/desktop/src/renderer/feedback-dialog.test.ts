// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import {
  FEEDBACK_KIND,
  type FeedbackKind,
  type FeedbackResult,
  type FeedbackSubmission,
} from "@sidecar/feedback";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "#shared/messages/acts";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { useAppCommand, useMenuCommands } from "./app-commands";
import { FeedbackDialog } from "./feedback-dialog";
import { ToastHost } from "./toast";

/** The two Help items that open the dialog, one per kind of note. */
type FeedbackCommand = typeof APP_COMMAND.SEND_FEEDBACK | typeof APP_COMMAND.SUGGEST_FEATURE;

const SIGNED_IN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  name: "Ada Lovelace",
  email: "ada@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

/** One byte of PNG, enough for the dialog to carry it as it is. */
function screenshot(name: string): File {
  return new File([new Uint8Array([137])], name, { type: "image/png" });
}

/** What the dialog asked the main process to send, and how the next send is answered. */
let sent: Act[] = [];
let answer: FeedbackResult = { delivered: true };
let menuListener: ((command: AppCommand) => void) | undefined;

beforeEach(() => {
  sent = [];
  answer = { delivered: true };
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        sent.push(request);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: answer });
      },
      onMenuCommand: (listener: (command: AppCommand) => void) => {
        menuListener = listener;
        return () => {
          menuListener = undefined;
        };
      },
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
    (each) => (each.getAttribute("aria-label") ?? each.textContent?.replace(/⌘↩$/u, "")) === name,
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

/** Types into the field the way a keystroke does, so React hears a change. */
function type(text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  assert.ok(setValue);
  act(() => {
    setValue.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

/** Lets an answer already on its way land. */
async function settle(): Promise<void> {
  await act(async () => undefined);
}

/** Waits for screenshots being read off disk to land as thumbnails. */
async function thumbnailsLand(expected: readonly string[]): Promise<void> {
  await vi.waitFor(async () => {
    await settle();
    assert.deepEqual(thumbnails(), expected);
  });
}

/** Picks files through the dialog's own screenshot button, and waits for them to be read. */
async function pick(files: readonly File[], expected: readonly string[]): Promise<void> {
  const input = dialog()?.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input, "the screenshot button has a picker behind it");
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await thumbnailsLand(expected);
}

function thumbnails(): readonly string[] {
  return [...(dialog()?.querySelectorAll<HTMLImageElement>("li img") ?? [])].map(
    (image) => image.alt,
  );
}

/** The notes the dialog asked to send, in the order it asked. */
function submissions(): readonly FeedbackSubmission[] {
  return sent.flatMap((each) =>
    each.kind === ACT_KIND.FEEDBACK_SEND ? [each.payload.submission] : [],
  );
}

function error(): string | undefined {
  return dialog()?.querySelector('[role="alert"]')?.textContent ?? undefined;
}

test("each of Help's items opens the dialog of its own kind, with the field taking the keyboard", () => {
  mount();

  const feedback = openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  assert.equal(feedback.querySelector("h2")?.textContent, "Send feedback");
  assert.equal(document.activeElement, field());
  assert.equal(field().placeholder, "What happened, and what did you expect?");
  assert.ok(feedback.closest(".ph-no-capture"), "the dialog is left out of the screen recording");

  act(() => button("Cancel").click());
  const prompt = openFromHelp(APP_COMMAND.SUGGEST_FEATURE);
  assert.equal(prompt.querySelector("h2")?.textContent, "Suggest a feature");
});

test("Send waits for words: whitespace is not a note", () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  assert.equal(button("Send").disabled, true);

  type("  \n ");
  assert.equal(button("Send").disabled, true);
  press("Enter", { metaKey: true });
  assert.deepEqual(sent, [], "Command-Enter sends nothing either");

  type("The plan lost a question");
  assert.equal(button("Send").disabled, false);
});

test("Command-Enter sends the words signed with the account, closes the dialog, and says it went", async () => {
  mount();
  // Whatever held the keyboard when Help was chosen is what the dialog hands it back to.
  const opener = document.body.appendChild(document.createElement("button"));
  act(() => opener.focus());
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  type("  The plan lost a question  ");

  press("Enter", { metaKey: true });
  await settle();

  assert.deepEqual(sent, [
    {
      kind: ACT_KIND.FEEDBACK_SEND,
      payload: {
        submission: {
          kind: FEEDBACK_KIND.FEEDBACK,
          message: "The plan lost a question",
          name: "Ada Lovelace",
          email: "ada@example.com",
          images: [],
        },
      },
    },
  ]);
  assert.equal(dialog(), null);
  assert.equal(document.querySelector(".toast")?.textContent, "Thanks — sent");
  assert.equal(document.activeElement, opener, "focus goes back to what opened the dialog");

  // A delivered note is gone: the next opening starts empty.
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  assert.equal(field().value, "");
});

test("the signature line says who the note is from, and unticking it sends the note unsigned", async () => {
  mount();
  openFromHelp(APP_COMMAND.SUGGEST_FEATURE);
  assert.match(dialog()?.textContent ?? "", /Sending as Ada Lovelace · ada@example\.com/u);

  type("Export a plan as a PDF");
  const include = dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  assert.ok(include?.checked, "a note starts signed");
  act(() => include.click());
  act(() => button("Send").click());
  await settle();

  assert.deepEqual(sent, [
    {
      kind: ACT_KIND.FEEDBACK_SEND,
      payload: {
        submission: { kind: FEEDBACK_KIND.PROMPT, message: "Export a plan as a PDF", images: [] },
      },
    },
  ]);
});

test("signed out, there is no one to sign as, so the note goes unsigned", async () => {
  mount({ status: ACCOUNT_STATUS.SIGNED_OUT });
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  assert.equal(dialog()?.querySelector('input[type="checkbox"]'), null);

  type("Sign-in never finished");
  act(() => button("Send").click());
  await settle();

  assert.deepEqual(submissions(), [
    { kind: FEEDBACK_KIND.FEEDBACK, message: "Sign-in never finished", images: [] },
  ]);
});

test("screenshots come along as thumbnails, each removable, and no more than three", async () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);

  await pick([screenshot("one.png"), screenshot("two.png")], ["one.png", "two.png"]);

  act(() => button("Remove one.png").click());
  assert.deepEqual(thumbnails(), ["two.png"]);

  await pick(
    [screenshot("three.png"), screenshot("four.png"), screenshot("five.png")],
    ["two.png", "three.png", "four.png"],
  );
  assert.equal(error(), "Up to 3 screenshots can come along.");
  assert.equal(button("Attach screenshot").disabled, true, "a full note offers no more room");

  type("Here is what I saw");
  assert.equal(error(), undefined, "typing again puts the refusal away");
  act(() => button("Send").click());
  await settle();
  assert.deepEqual(
    submissions().flatMap((each) => each.images.map((image) => image.name)),
    ["two.png", "three.png", "four.png"],
  );
});

test("a screenshot pasted into the field or dropped on the dialog comes along too", async () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);

  const pasted = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(pasted, "clipboardData", { value: { files: [screenshot("paste.png")] } });
  act(() => {
    field().dispatchEvent(pasted);
  });
  await thumbnailsLand(["paste.png"]);
  assert.equal(pasted.defaultPrevented, true, "an image is not pasted as text");

  const dropped = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropped, "dataTransfer", {
    value: { types: ["Files"], files: [screenshot("drop.png")] },
  });
  act(() => {
    dialog()?.dispatchEvent(dropped);
  });
  await thumbnailsLand(["paste.png", "drop.png"]);
});

test("Escape closes the dialog alone and keeps the words for next time; Cancel discards them", () => {
  mount();
  const windowKeys: string[] = [];
  const hear = (event: KeyboardEvent) => windowKeys.push(event.key);
  window.addEventListener("keydown", hear);
  try {
    openFromHelp(APP_COMMAND.SEND_FEEDBACK);
    type("Half a thought");
    press("Escape");
    assert.equal(dialog(), null);
    assert.deepEqual(windowKeys, [], "the window behind never hears the Escape");

    openFromHelp(APP_COMMAND.SEND_FEEDBACK);
    assert.equal(field().value, "Half a thought");

    act(() => button("Cancel").click());
    openFromHelp(APP_COMMAND.SEND_FEEDBACK);
    assert.equal(field().value, "");
  } finally {
    window.removeEventListener("keydown", hear);
  }
});

test("a press on the dimmed window closes the dialog like Escape", () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  type("Half a thought");
  const backdrop = dialog()?.parentElement;
  assert.ok(backdrop);
  act(() => {
    backdrop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    backdrop.click();
  });
  assert.equal(dialog(), null);

  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  assert.equal(field().value, "Half a thought");
});

test("a refused send keeps the dialog, the words, and says why", async () => {
  answer = { delivered: false, reason: "Feedback is turned off for this build." };
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  type("It broke");
  act(() => button("Send").click());
  await settle();

  assert.ok(dialog(), "the dialog stays");
  assert.equal(error(), "Feedback is turned off for this build.");
  assert.equal(field().value, "It broke");
  assert.equal(document.querySelector(".toast"), null, "nothing claims it went");
});

test("each kind keeps its own draft, so a note is sent as the kind it was written as", async () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  type("The plan deleted my question");
  press("Escape");

  openFromHelp(APP_COMMAND.SUGGEST_FEATURE);
  assert.equal(field().value, "", "the other kind starts empty");
  type("Export a plan as a PDF");
  act(() => button("Send").click());
  await settle();

  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  assert.equal(field().value, "The plan deleted my question");
  act(() => button("Send").click());
  await settle();

  assert.deepEqual(
    submissions().map((each) => [each.kind, each.message]),
    [
      [FEEDBACK_KIND.PROMPT, "Export a plan as a PDF"],
      [FEEDBACK_KIND.FEEDBACK, "The plan deleted my question"],
    ],
  );
});

test("a screenshot still being read when its draft is cancelled lands in no draft", async () => {
  mount();
  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  const input = dialog()?.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [screenshot("old.png")] });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  act(() => button("Cancel").click());

  openFromHelp(APP_COMMAND.SEND_FEEDBACK);
  await pick([screenshot("new.png")], ["new.png"]);
});
