// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { FEEDBACK_KIND, type FeedbackKind, type FeedbackResult } from "@luke/features/feedback";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { fakeAppBridge } from "#testing/app-bridge";
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
/** What the dialog asked the main process to send, and how the next send is answered. */
let sent: Act[] = [];
let answer: FeedbackResult = { delivered: true };
let menuListener: ((command: AppCommand) => void) | undefined;

beforeEach(() => {
  sent = [];
  answer = { delivered: true };
  fakeAppBridge({
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
    (each) => (each.getAttribute("aria-label") ?? each.textContent?.replace(/⌘⏎$/u, "")) === name,
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
  assert.ok(feedback.closest(".ph-no-capture"), "the dialog is left out of the screen recording");

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
          about: EXPERIMENT.FACTORY,
          account: SIGNED_IN,
          onClose: () => undefined,
        }),
      ),
    ),
  );

  assert.equal(dialog()?.querySelector("h2")?.textContent, "Feedback on Factory");
  // React reads a typed value off the element's own setter, as a keystroke sets it.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field(), "The board missed a plan.");
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Send").click());

  assert.deepEqual(sent.find((request) => request.kind === ACT_KIND.FEEDBACK_SEND)?.payload, {
    submission: {
      kind: FEEDBACK_KIND.FEEDBACK,
      message: "The board missed a plan.",
      name: SIGNED_IN.name,
      email: SIGNED_IN.email,
      images: [],
      experiment: EXPERIMENT.FACTORY,
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
  const draw = (about: typeof EXPERIMENT.FACTORY | undefined) =>
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

  draw(EXPERIMENT.FACTORY);
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
