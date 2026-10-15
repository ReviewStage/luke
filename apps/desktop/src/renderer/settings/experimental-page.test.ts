// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT, EXPERIMENTS, type Experiment, NO_EXPERIMENTS } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { OpenFeedbackProvider } from "../open-feedback";
import { ExperimentalPage } from "./experimental-page";

/**
 * Settings › Experimental as the panel draws it: a switch per experiment
 * that writes the account's choice, a Send feedback that opens the dialog
 * about that experiment, the empty Inbox's empty state while none stands,
 * and a note while signed out. Nothing of its own above the rows.
 */

/** What the page asked the main process for. */
let sent: Act[] = [];
/** Which experiment each Send feedback opened the dialog about. */
let feedbackAbout: Experiment[] = [];
const roots: Root[] = [];

beforeEach(() => {
  sent = [];
  feedbackAbout = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act) => {
        sent.push(request);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { status: ACTION_RESULT_STATUS.ACCEPTED, settings: {} },
        });
      },
      recordSurfaceEvent: () => undefined,
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
    experiments: experimentsOn(EXPERIMENT.FACTORY),
    signedIn: true,
  });

  const factory = page.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Factory"]');
  assert.ok(factory, "Factory has a switch");
  assert.equal(factory.getAttribute("aria-checked"), "true");
  // The row's one line says what turning it on brings; the page says nothing above the rows, the newest experiment's first.
  assert.ok(page.textContent?.startsWith("Video calls"));

  await act(async () => factory.click());
  assert.deepEqual(sent, [
    { kind: ACT_KIND.EXPERIMENT_SET, payload: { experiment: EXPERIMENT.FACTORY, on: false } },
  ]);
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
    EXPERIMENT.VIDEO_CALLS,
    EXPERIMENT.AUTOMATIONS,
    EXPERIMENT.FACTORY,
  ]);
});

test("with no experiment standing, the page draws the empty state with its title", () => {
  const page = draw({ entries: [], experiments: NO_EXPERIMENTS, signedIn: true });

  assert.equal(page.querySelector('[role="switch"]'), null);
  assert.equal(page.querySelector("h3")?.textContent, "No experiments right now");
  assert.ok(page.textContent?.includes("New features show up here to try before they ship."));
});

test("signed out, the page says to sign in rather than drawing switches no account holds", () => {
  const page = draw({ entries: EXPERIMENTS, experiments: NO_EXPERIMENTS, signedIn: false });

  assert.equal(page.textContent, "Sign in to try experiments.");
});
