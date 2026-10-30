// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SETTINGS_ACT_KIND } from "@luke/host/contract";
import { EXPERIMENT, EXPERIMENTS, type Experiment, NO_EXPERIMENTS } from "@luke/settings";
import { appSettingsWire, experimentsOn, settingsView } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { OpenFeedbackProvider } from "../open-feedback.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { ExperimentalPage } from "./experimental-page.js";

/**
 * Settings › Experimental as the panel draws it: a switch per experiment
 * that writes the account's choice, a Send feedback that opens the dialog
 * about that experiment, the empty Inbox's empty state while none stands,
 * and a note while signed out. Nothing of its own above the rows.
 */

/** Each experiment switch the page asked the main process for, as its payload carried it. */
let sent: unknown[] = [];
/** Which experiment each Send feedback opened the dialog about. */
let feedbackAbout: Experiment[] = [];
const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  sent = [];
  feedbackAbout = [];
  fakeActPort({
    [SETTINGS_ACT_KIND.EXPERIMENT_SET]: (payload) => {
      sent.push(payload);
      return Promise.resolve({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: appSettingsWire(settingsView()),
      });
    },
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

function draw(props: Parameters<typeof ExperimentalPage>[0]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          OpenFeedbackProvider,
          { value: (about: Experiment) => feedbackAbout.push(about) },
          createElement(ExperimentalPage, props),
        ),
      ),
    ),
  );
  return container;
}

test("each experiment is a switch, on as the account chose, that writes the choice it is pressed to", async () => {
  const page = draw({
    entries: EXPERIMENTS,
    experiments: experimentsOn(EXPERIMENT.MEMORY),
    signedIn: true,
  });

  const memory = page.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Memory"]');
  assert.ok(memory, "Memory has a switch");
  assert.equal(memory.getAttribute("aria-checked"), "true");
  // The row's one line says what turning it on brings; the page says nothing above the rows, the newest experiment's first.
  assert.ok(page.textContent?.startsWith("Skills"));
  assert.deepEqual(
    [...page.querySelectorAll('[role="switch"]')]
      .slice(0, 2)
      .map((each) => each.getAttribute("aria-label")),
    ["Skills", "Pilot"],
    "Pilot stands second, after the newest",
  );

  await act(async () => memory.click());
  assert.deepEqual(sent, [{ experiment: EXPERIMENT.MEMORY, on: false }]);
});

test("an experiment's Send feedback opens the dialog about that experiment", () => {
  const page = draw({ entries: EXPERIMENTS, experiments: NO_EXPERIMENTS, signedIn: true });

  const feedback = [...page.querySelectorAll("button")].filter(
    (button) => button.textContent === "Send feedback",
  );
  act(() => {
    for (const button of feedback) button.click();
  });
  assert.deepEqual(feedbackAbout, [
    EXPERIMENT.SKILLS,
    EXPERIMENT.PILOT,
    EXPERIMENT.CHANNELS,
    EXPERIMENT.MEMORY,
    EXPERIMENT.OPERATOR,
  ]);
});

test("with no experiment standing, the page draws the empty state", () => {
  const page = draw({ entries: [], experiments: NO_EXPERIMENTS, signedIn: true });

  assert.equal(page.querySelector('[role="switch"]'), null);
  assert.equal(page.textContent, "No experiments.");
});

test("signed out, the page says to sign in rather than drawing switches no account holds", () => {
  const page = draw({ entries: EXPERIMENTS, experiments: NO_EXPERIMENTS, signedIn: false });

  assert.equal(page.textContent, "Sign in to use this page.");
});
