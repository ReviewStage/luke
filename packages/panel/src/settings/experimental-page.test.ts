// @vitest-environment jsdom

import assert from "node:assert/strict";
import { VIDEO_AVATAR, VIDEO_AVATAR_COVER_ORIGIN } from "@luke/features/video-avatar";
import { SETTINGS_ACT_KIND } from "@luke/host/contract";
import {
  type AppSettingField,
  EXPERIMENT,
  EXPERIMENTS,
  type Experiment,
  type ExperimentChoices,
  NO_EXPERIMENTS,
} from "@luke/settings";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@luke/settings/settings-anchors";
import { appSettingsWire, experimentsOn, settingsView } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { APP_SETTING_ID } from "@luke/wire/app-settings";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { OpenFeedbackProvider } from "../open-feedback.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { ExperimentalPage } from "./experimental-page.js";
import type { SettingsWrites } from "./writes.js";

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
/** Each stored setting a row wrote, with the value it wrote. */
let written: [AppSettingField, unknown][] = [];
const writes: SettingsWrites = {
  setting: (field, value) => {
    written.push([field, value]);
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  },
  reset: () => Promise.reject(new Error("the Experimental page resets nothing")),
};
const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  sent = [];
  feedbackAbout = [];
  written = [];
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

/** What the schema rows are judged from, signed in, with these experiments on. */
function rowsInput(experiments: ExperimentChoices) {
  return {
    settings: settingsView({ experiments }),
    voiceControlsDrawn: false,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  };
}

function draw(
  props: Omit<Parameters<typeof ExperimentalPage>[0], "writes"> & { writes?: SettingsWrites },
): HTMLElement {
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
          createElement(ExperimentalPage, { writes, ...props }),
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
  assert.ok(page.textContent?.startsWith("Code review"));

  await act(async () => factory.click());
  assert.deepEqual(sent, [{ experiment: EXPERIMENT.FACTORY, on: false }]);
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
    EXPERIMENT.CODE_REVIEW,
    EXPERIMENT.BROWSER,
    EXPERIMENT.SECTIONS,
    EXPERIMENT.CHAT,
    EXPERIMENT.VIDEO_CALLS,
    EXPERIMENT.FACTORY,
  ]);
});

test("with no experiment standing, the page draws the empty state", () => {
  const page = draw({ entries: [], experiments: NO_EXPERIMENTS, signedIn: true });

  assert.equal(page.querySelector('[role="switch"]'), null);
  assert.equal(page.textContent, "No experiments");
});

test("signed out, the page says to sign in rather than drawing switches no account holds", () => {
  const page = draw({ entries: EXPERIMENTS, experiments: NO_EXPERIMENTS, signedIn: false });

  assert.equal(page.textContent, "Sign in to try experiments.");
});

/** The words the elements an attribute's ids name say, as a reader hears them. */
function wordsOf(element: Element, attribute: string): string {
  return (element.getAttribute(attribute) ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

test("with Video calls on, its avatar is chosen from every face at once in its card beneath its switch, and the choice is written to this Mac", async () => {
  const experiments = experimentsOn(EXPERIMENT.VIDEO_CALLS);
  const page = draw({
    entries: EXPERIMENTS,
    experiments,
    signedIn: true,
    view: rowsInput(experiments),
  });

  // Each experiment is a card of its own, and the avatar stands in Video calls' card, under its switch.
  const cards = [...page.querySelectorAll("section")].map((card) =>
    [...card.querySelectorAll('[role="switch"], [aria-haspopup], fieldset')].map((control) =>
      control instanceof HTMLFieldSetElement
        ? wordsOf(control, "aria-labelledby")
        : // A chip's name ends with the value it names, which is not the row's.
          control.getAttribute("aria-label")?.split(": ")[0],
    ),
  );
  assert.deepEqual(cards, [
    ["GitHub personal access token"],
    ["Code review"],
    ["Browser tab"],
    ["Sections"],
    ["Chat"],
    ["Video calls", "Avatar"],
    ["Factory"],
  ]);

  // Every face stands open, with no menu to open first: one radio group, Atlas chosen at first.
  const group = page.querySelector("fieldset");
  assert.ok(group instanceof HTMLFieldSetElement);
  assert.equal(
    wordsOf(group, "aria-describedby"),
    "Who Luke appears as on video. A new choice shows the next time video starts.",
  );
  const faces = [...group.querySelectorAll("label")];
  const radios = faces.map((face) => face.querySelector<HTMLInputElement>('input[type="radio"]'));
  assert.deepEqual(
    faces.map((face) => face.textContent),
    ["Atlas", "Caspian", "Cassidy", "Celia", "Cosmo", "Lyra", "Orion", "Selene"],
  );
  assert.equal(new Set(radios.map((radio) => radio?.name)).size, 1);
  assert.deepEqual(
    radios.map((radio) => radio?.checked),
    [true, false, false, false, false, false, false, false],
  );
  // Each shows its face from Keyframe's storage, and the chosen one stands large beside them all.
  for (const face of faces) {
    const picture = face.querySelector("img")?.getAttribute("src");
    assert.ok(picture?.startsWith(`${VIDEO_AVATAR_COVER_ORIGIN}/personas/`), String(picture));
  }
  const stage = page.querySelector(".picture-choice-stage");
  assert.equal(stage?.textContent, "Atlas");
  assert.equal(
    stage?.querySelector("img")?.getAttribute("src"),
    faces[0]?.querySelector("img")?.getAttribute("src"),
  );
  // A search result for Avatar lands on the row whole, its name and faces, so the ring it draws is seen.
  const landed = page.querySelector(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${APP_SETTING_ID.VIDEO_AVATAR}"]`,
  );
  assert.ok(landed?.contains(group));
  assert.ok(landed?.textContent?.startsWith("Avatar"));

  const celia = faces[3];
  assert.ok(celia instanceof HTMLElement);
  await act(async () => celia.click());
  assert.deepEqual(written, [["videoAvatar", VIDEO_AVATAR.CELIA]]);
});

test("with Video calls off, no avatar is offered", () => {
  const page = draw({
    entries: EXPERIMENTS,
    experiments: NO_EXPERIMENTS,
    signedIn: true,
    view: rowsInput(NO_EXPERIMENTS),
  });

  assert.equal(page.querySelector('input[type="radio"]'), null);
  assert.equal(page.querySelectorAll("section").length, EXPERIMENTS.length);
});
