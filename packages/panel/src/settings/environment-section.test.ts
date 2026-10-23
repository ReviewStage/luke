// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  WORKSPACE_ENVIRONMENT_KIND,
  WORKSPACE_ENVIRONMENT_REJECTION,
  type WorkspaceEnvironmentEntry,
} from "@luke/features/workspace-environment-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { WireBoundaryInput } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPortAnswering, fakeAppBridge, type SentPortAct } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { EnvironmentGroup } from "./environment-section.js";

/**
 * Settings › Workspace › Environment over a bridge answering as the host
 * would: a member reads a variable with its value and a secret by its hint
 * alone, and is offered no change; an owner or admin adds a secret into a
 * masked field that keeps its line breaks, sent once and gone from the page
 * once kept; editing a variable starts from its value and a secret from
 * nothing; a name or value the service would refuse is refused on the page,
 * saying why, and sends nothing; a save past the workspace's bound says why.
 * Synthetic workspaces and values.
 */

const PASTED = "sk_test_synthetic_0000wxyz";

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: null,
};

const VARIABLE: WorkspaceEnvironmentEntry = {
  name: "APP_MODE",
  kind: WORKSPACE_ENVIRONMENT_KIND.VARIABLE,
  value: "development",
  readable: true,
  updatedAt: Date.UTC(2026, 9, 12, 12),
};

const SECRET: WorkspaceEnvironmentEntry = {
  name: "STRIPE_KEY",
  kind: WORKSPACE_ENVIRONMENT_KIND.SECRET,
  hint: "…wxyz",
  readable: true,
  updatedAt: Date.UTC(2026, 9, 12, 12),
};

/** The entries the test's service holds, read and written by the page. */
let stored: WorkspaceEnvironmentEntry[] = [];
/** Every act the page sent, in order. */
let sent: SentPortAct[] = [];
/** Whether the service answers the next save as past the workspace's bound. */
let tooMany = false;
/** Where a save is held unanswered until the test lets it go, rather than answered at once. */
let heldSave: ((answer: WireBoundaryInput) => void) | undefined;
let holdSave = false;

/** What a save asked for, as the page sent it. */
interface SaveAsked {
  readonly name: string;
  readonly kind: string;
  readonly secretValue: string;
}

/** The fake host, answering the page's acts the way the host would. */
function answer(request: SentPortAct): Promise<WireBoundaryInput> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.WORKSPACE_ENVIRONMENT_READ:
      return Promise.resolve({ entries: stored });
    case ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE: {
      if (holdSave) {
        return new Promise((resolve) => {
          heldSave = resolve;
        });
      }
      if (tooMany) {
        return Promise.resolve({
          entries: stored,
          rejected: WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY,
        });
      }
      // SAFETY: the port admitted the payload under the save's own schema before the fake was asked.
      const { name, kind, secretValue } = request.payload as unknown as SaveAsked;
      const kept: WorkspaceEnvironmentEntry =
        kind === WORKSPACE_ENVIRONMENT_KIND.SECRET
          ? { ...SECRET, name }
          : { ...VARIABLE, name, value: secretValue };
      stored = [...stored.filter((each) => each.name !== name), kept];
      return Promise.resolve({ entries: stored });
    }
    case ACT_KIND.WORKSPACE_ENVIRONMENT_REMOVE: {
      // SAFETY: the port admitted the payload under the removal's own schema before the fake was asked.
      const { name } = request.payload as unknown as { readonly name: string };
      stored = stored.filter((each) => each.name !== name);
      return Promise.resolve({ entries: stored });
    }
    default:
      return Promise.resolve(null);
  }
}

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = [];
  sent = [];
  tooMany = false;
  holdSave = false;
  heldSave = undefined;
  fakeAppBridge({});
  fakeActPortAnswering(answer);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

async function mount(workspace: Workspace): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(EnvironmentGroup, { workspace })));
  await settle();
  return container;
}

const button = (_page: Element, words: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${words} button`);

/** The dialog's field its label names: the dialog stands in the body, outside the section. */
const field = (_page: HTMLElement, label: string) => {
  const named = [...document.querySelectorAll<HTMLLabelElement>(".luke-field-label")].find(
    (each) => each.textContent === label,
  );
  const control = named === undefined ? null : document.getElementById(named.htmlFor);
  return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
    ? control
    : assert.fail(`no ${label} field`);
};

/** Types `text` into a field as the page would hand it to React. */
function type(entry: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const prototype =
    entry instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(entry, text);
    entry.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(page: HTMLElement): Promise<void> {
  act(() => button(page, "Save").click());
  await settle();
}

/** Opens the form, types a name, chooses the kind, types a value, and saves. */
async function add(page: HTMLElement, name: string, kind: string, value: string): Promise<void> {
  act(() => button(page, "Add variable").click());
  type(field(page, "Name"), name);
  act(() => button(page, kind).click());
  type(field(page, "Value"), value);
  await submit(page);
}

/** What the open dialog says went wrong. */
const refusal = (page: HTMLElement) =>
  [...document.querySelectorAll(".luke-field-error")]
    .map((each) => each.textContent ?? "")
    .join("");

const saves = () => sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE);

test("a member reads a variable with its value and a secret by its hint alone, and is offered no change", async () => {
  stored = [VARIABLE, SECRET];
  const page = await mount({ ...ACME, role: WORKSPACE_ROLE.MEMBER });

  const text = page.textContent ?? "";
  assert.match(text, /APP_MODE\s*development · Saved /u);
  assert.match(text, /STRIPE_KEY\s*Secret · …wxyz · Saved /u);
  assert.match(text, /Only an owner or admin can change them\./u);
  assert.equal(
    [...page.querySelectorAll("button")].some((each) => each.textContent === "Add variable"),
    false,
  );
});

test("an admin's secret keeps its line breaks in a masked field, is sent once, and is gone from the window once kept", async () => {
  const certificate = `-----BEGIN CERTIFICATE-----\n${PASTED}\n-----END CERTIFICATE-----`;
  const page = await mount(ACME);

  act(() => button(page, "Add variable").click());
  type(field(page, "Name"), "TLS_CERT");
  act(() => button(page, "Secret").click());
  assert.equal(field(page, "Value").getAttribute("data-masked"), "true", "drawn as discs");
  type(field(page, "Value"), certificate);
  await submit(page);

  assert.deepEqual(
    saves().map((request) => request.payload),
    [
      {
        workspaceId: ACME.id,
        name: "TLS_CERT",
        kind: WORKSPACE_ENVIRONMENT_KIND.SECRET,
        secretValue: certificate,
      },
    ],
  );
  assert.equal(document.querySelector('[role="dialog"]'), null, "the dialog closes once the secret is kept");
  assert.ok(!document.body.innerHTML.includes(PASTED), "the window holds the secret nowhere once kept");
  assert.match(page.textContent ?? "", /TLS_CERT\s*Secret · …wxyz/u);
});

test("a name or value the service would refuse is refused in the dialog, saying why, and nothing is sent", async () => {
  const page = await mount(ACME);

  await add(page, "lower_case", "Variable", "x");
  const said = [refusal(page)];
  for (const [name, value] of [
    ["PATH", "x"],
    ["A".repeat(129), "x"],
    ["BIG", "x".repeat(16_385)],
  ] as const) {
    type(field(page, "Name"), name);
    type(field(page, "Value"), value);
    await submit(page);
    said.push(refusal(page));
  }
  act(() => button(page, "Secret").click());
  type(field(page, "Value"), "123");
  await submit(page);
  said.push(refusal(page));

  assert.deepEqual(said, [
    "Use capital letters, digits, and underscores, not starting with a digit.",
    "PATH is set by the sandbox or Luke. Choose another name.",
    "A name can be at most 128 characters.",
    "A value can be at most 16,384 characters.",
    "A secret must be at least 4 characters, so it can be hidden in command output.",
  ]);
  assert.deepEqual(saves(), []);
});

test("a save past the workspace's bound says why and keeps the dialog open", async () => {
  tooMany = true;
  const page = await mount(ACME);

  await add(page, "ONE_MORE", "Variable", "x");

  assert.equal(
    refusal(page),
    "This workspace already holds 100 variables and secrets. Remove one first.",
  );
  assert.ok(document.querySelector('[role="dialog"]'), "the dialog stays open");
});

test("editing a variable starts from its value, and editing a secret from nothing", async () => {
  stored = [VARIABLE, SECRET];
  const page = await mount(ACME);
  const edit = async (name: string) => {
    const more = page.querySelector<HTMLButtonElement>(`button[aria-label="${name} actions"]`);
    act(() => (more ?? assert.fail(`no ⋯ for ${name}`)).click());
    await settle();
    act(() => button(document.body, "Edit").click());
    await settle();
  };

  await edit("APP_MODE");
  const variable = field(page, "Value").value;
  act(() => button(page, "Cancel").click());
  await edit("STRIPE_KEY");
  const secret = field(page, "Value").value;

  assert.deepEqual([variable, secret], ["development", ""]);
});

test("Escape while a save is on its way keeps the dialog open, so the service's refusal stands in it", async () => {
  holdSave = true;
  const page = await mount(ACME);

  act(() => button(page, "Add variable").click());
  type(field(page, "Name"), "ONE_MORE");
  type(field(page, "Value"), "kept");
  await submit(page);
  const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    button(page, "Save").dispatchEvent(press);
  });
  const openWhileSaving = document.querySelector('[role="dialog"]') !== null;
  await act(async () => {
    heldSave?.({ entries: [], rejected: WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY });
  });
  await settle();

  assert.equal(press.defaultPrevented, true);
  assert.equal(openWhileSaving, true);
  assert.equal(field(page, "Value").value, "kept");
  assert.equal(
    refusal(page),
    "This workspace already holds 100 variables and secrets. Remove one first.",
  );
});

test("the group and its fields are kept out of the screen recording", async () => {
  const page = await mount(ACME);

  act(() => button(page, "Add variable").click());

  assert.ok(
    page.querySelector(".ph-no-capture section"),
    "the group is under the unrecorded class",
  );
  assert.ok(field(page, "Value").closest(".ph-no-capture"));
});
