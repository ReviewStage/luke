// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_ACT_KIND, WORKSPACE_ACT_KIND } from "@repo/host/contract";
import { EXPERIMENT, EXPERIMENTS, type Experiment, NO_EXPERIMENTS } from "@repo/settings";
import { appSettingsWire, experimentsOn, settingsView } from "@repo/settings/testing";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { OpenFeedbackProvider } from "../open-feedback.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { ExperimentalPage } from "./experimental-page.js";

/**
 * Settings › Experimental as the panel draws it: the workspace's experiments
 * under a heading naming whom they reach, each saying who last changed it,
 * locked for a member who is no admin, and asking before a flip reaches
 * everyone; the account's own under a heading of their own, written at once;
 * a Send feedback per experiment; the empty state while none stands; and a
 * note while signed out.
 */

/** The workspace Settings shows: Task descriptions turned on by Dean, Pilot never chosen. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: null,
  memberCount: 6,
  experiments: [
    {
      experiment: EXPERIMENT.DESCRIPTIONS,
      on: true,
      changedBy: { id: "user-dean", name: "Dean Stratakos" },
      changedAt: Date.UTC(2026, 10, 6, 12),
    },
  ],
};

/** Each act the page sent, by its kind, as its payload carried it. */
let sent: { readonly kind: string; readonly payload: unknown }[] = [];
/** Which experiment each Send feedback opened the dialog about. */
let feedbackAbout: Experiment[] = [];
const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  handState({});
  sent = [];
  feedbackAbout = [];
  fakeActPort({
    [SETTINGS_ACT_KIND.EXPERIMENT_SET]: (payload) => {
      sent.push({ kind: SETTINGS_ACT_KIND.EXPERIMENT_SET, payload });
      return Promise.resolve({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: appSettingsWire(settingsView()),
      });
    },
    [WORKSPACE_ACT_KIND.WORKSPACE_EXPERIMENT_SET]: (payload) => {
      sent.push({ kind: WORKSPACE_ACT_KIND.WORKSPACE_EXPERIMENT_SET, payload });
      return Promise.resolve(ACME);
    },
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

function draw(props: Partial<Parameters<typeof ExperimentalPage>[0]>): HTMLElement {
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
          createElement(ExperimentalPage, {
            entries: EXPERIMENTS,
            experiments: NO_EXPERIMENTS,
            signedIn: true,
            workspace: ACME,
            readerId: "user-dana",
            ...props,
          }),
        ),
      ),
    ),
  );
  return container;
}

function switchNamed(page: HTMLElement, name: string): HTMLButtonElement {
  return (
    page.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${name}"]`) ??
    assert.fail(`no switch named ${name}`)
  );
}

/** The groups' headings and captions, as a reader moving by landmark hears them. */
function groups(page: HTMLElement): (string | undefined)[][] {
  return [...page.querySelectorAll("section")].map((section) => [
    section.querySelector("h2")?.textContent ?? undefined,
    document.getElementById(section.getAttribute("aria-describedby") ?? "")?.textContent ??
      undefined,
  ]);
}

/** The button of the question standing over the window that says `words`. */
function answer(words: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
      (button) => button.textContent === words,
    ) ?? assert.fail(`no answer ${words}`)
  );
}

test("the workspace's experiments and the account's own stand in two groups, each saying whom it reaches", () => {
  const page = draw({});

  assert.deepEqual(groups(page), [
    [
      "For everyone in Acme",
      "These change Vespin for every member and agent in Acme. Only admins can change them.",
    ],
    ["Just for you", "These change Vespin only for you, in every workspace you're in."],
  ]);
  assert.deepEqual(
    [...page.querySelectorAll('[role="switch"]')].map((each) => each.getAttribute("aria-label")),
    ["Task descriptions", "Pilot", "Memory", "Bring your own host", "Skills"],
  );
});

test("a workspace switch says who last turned it on and when, and an admin's flip asks first, then turns it for everyone", async () => {
  const page = draw({});
  const descriptions = switchNamed(page, "Task descriptions");
  assert.equal(descriptions.getAttribute("aria-checked"), "true");
  const chip = page.querySelector("[data-actor-ref]");
  assert.equal(chip?.querySelector(".ui-inline-ref-label")?.textContent, "Dean Stratakos");
  assert.match(chip?.parentElement?.textContent ?? "", /^Turned on by .*Dean Stratakos on Nov 6$/u);

  await act(async () => descriptions.click());

  assert.deepEqual(sent, [], "nothing is sent before the question is answered");
  const dialog = document.querySelector('[role="alertdialog"]');
  assert.match(dialog?.textContent ?? "", /Turn off Task descriptions for everyone in Acme\?/u);
  assert.match(dialog?.textContent ?? "", /all 6 members of Acme/u);
  assert.match(dialog?.textContent ?? "", /Nothing is deleted/u);
  await act(async () => answer("Turn off for everyone").click());
  await vi.waitFor(() =>
    assert.deepEqual(sent, [
      {
        kind: WORKSPACE_ACT_KIND.WORKSPACE_EXPERIMENT_SET,
        payload: { workspaceId: ACME.id, experiment: EXPERIMENT.DESCRIPTIONS, on: false },
      },
    ]),
  );
});

test("a member who is no admin sees the workspace's switches locked, saying only an admin can change them, and a press asks nothing", async () => {
  const page = draw({ workspace: { ...ACME, role: WORKSPACE_ROLE.MEMBER } });
  const pilot = switchNamed(page, "Pilot");

  await act(async () => pilot.click());

  assert.equal(pilot.getAttribute("aria-readonly"), "true");
  const described = (pilot.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  assert.match(described, /Only an admin can change this/u);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(sent, []);
});

test("an account's own experiment is on as the account chose, and writes the choice it is pressed to at once", async () => {
  const page = draw({ experiments: experimentsOn(EXPERIMENT.SKILLS) });
  const skills = switchNamed(page, "Skills");
  assert.equal(skills.getAttribute("aria-checked"), "true");

  await act(async () => skills.click());

  assert.deepEqual(sent, [
    {
      kind: SETTINGS_ACT_KIND.EXPERIMENT_SET,
      payload: { experiment: EXPERIMENT.SKILLS, on: false },
    },
  ]);
});

test("an experiment's Send feedback opens the dialog about that experiment", () => {
  const page = draw({});

  const feedback = [...page.querySelectorAll("button")].filter(
    (button) => button.textContent === "Send feedback",
  );
  act(() => {
    for (const button of feedback) button.click();
  });
  assert.deepEqual(feedbackAbout, [
    EXPERIMENT.DESCRIPTIONS,
    EXPERIMENT.PILOT,
    EXPERIMENT.MEMORY,
    EXPERIMENT.BRING_YOUR_OWN_HOST,
    EXPERIMENT.SKILLS,
  ]);
});

test("with no experiment standing, the page draws the empty state", () => {
  const page = draw({ entries: [] });

  assert.equal(page.querySelector('[role="switch"]'), null);
  assert.equal(page.textContent, "No experiments.");
});

test("signed out, the page says to sign in rather than drawing switches no account holds", () => {
  const page = draw({ signedIn: false });

  assert.equal(page.textContent, "Sign in to use this page.");
});
