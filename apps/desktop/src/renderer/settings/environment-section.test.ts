// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  WORKSPACE_ENVIRONMENT_KIND,
  WORKSPACE_ENVIRONMENT_REJECTION,
  type WorkspaceEnvironmentEntry,
} from "@luke/features/workspace-environment-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { EnvironmentGroup } from "./environment-section";

/**
 * Settings › Workspace › Environment over a bridge answering as the host
 * would: a member reads a variable with its value and a secret by its hint
 * alone, and changes nothing; an owner or admin adds a secret from a
 * password field, sent once and gone from the field once kept; a name the
 * service would refuse is refused on the page and sends nothing; a save past
 * the workspace's bound says why. Synthetic workspaces and values.
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
let sent: Act[] = [];
/** Whether the service answers the next save as past the workspace's bound. */
let tooMany = false;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the page's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.WORKSPACE_ENVIRONMENT_READ:
      return Promise.resolve(done({ entries: stored }));
    case ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE: {
      if (tooMany) {
        return Promise.resolve(
          done({ entries: stored, rejected: WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY }),
        );
      }
      const { name, kind } = request.payload;
      const kept: WorkspaceEnvironmentEntry =
        kind === WORKSPACE_ENVIRONMENT_KIND.SECRET
          ? { ...SECRET, name }
          : { ...VARIABLE, name, value: request.payload.secretValue };
      stored = [...stored.filter((each) => each.name !== name), kept];
      return Promise.resolve(done({ entries: stored }));
    }
    case ACT_KIND.WORKSPACE_ENVIRONMENT_REMOVE:
      stored = stored.filter((each) => each.name !== request.payload.name);
      return Promise.resolve(done({ entries: stored }));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = [];
  sent = [];
  tooMany = false;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
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

const button = (page: HTMLElement, words: string) =>
  [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${words} button`);

const input = (page: HTMLElement, label: string) =>
  page.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `:is(input, textarea)[aria-label="${label}"]`,
  ) ?? assert.fail(`no ${label} field`);

function type(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  act(() => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Opens the form, types a name, chooses the kind, types a value, and saves. */
async function add(page: HTMLElement, name: string, kind: string, value: string): Promise<void> {
  act(() => button(page, "Add variable or secret").click());
  type(input(page, "Name"), name);
  act(() => button(page, kind).click());
  type(input(page, "Value"), value);
  act(() => input(page, "Value").form?.requestSubmit());
  await settle();
}

const saves = () => sent.filter((request) => request.kind === ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE);

test("a member reads a variable with its value and a secret by its hint alone, and is offered no change", async () => {
  stored = [VARIABLE, SECRET];
  const page = await mount({ ...ACME, role: WORKSPACE_ROLE.MEMBER });

  const text = page.textContent ?? "";
  assert.match(text, /APP_MODE\s*development · Saved /u);
  assert.match(text, /STRIPE_KEY\s*Secret · …wxyz · Saved /u);
  assert.match(text, /Only an owner or admin of this workspace can change these\./u);
  assert.equal(
    [...page.querySelectorAll("button")].some(
      (each) => each.textContent === "Add variable or secret",
    ),
    false,
  );
});

test("an admin's secret is typed into a password field, sent once, gone from the page once kept, and drawn by its hint", async () => {
  const page = await mount(ACME);

  act(() => button(page, "Add variable or secret").click());
  type(input(page, "Name"), "STRIPE_KEY");
  act(() => button(page, "Secret").click());
  assert.ok(input(page, "Value").classList.contains("environment-secret"), "drawn as discs");
  type(input(page, "Value"), PASTED);
  act(() => input(page, "Value").form?.requestSubmit());
  await settle();

  assert.deepEqual(
    saves().map((request) => request.payload),
    [
      {
        workspaceId: ACME.id,
        name: "STRIPE_KEY",
        kind: WORKSPACE_ENVIRONMENT_KIND.SECRET,
        secretValue: PASTED,
      },
    ],
  );
  assert.equal(page.querySelector("form"), null, "the form closes once the secret is kept");
  assert.ok(!page.innerHTML.includes(PASTED), "the page holds the secret nowhere once kept");
  assert.match(page.textContent ?? "", /STRIPE_KEY\s*Secret · …wxyz/u);
});

test("a name the service would refuse is refused on the page, saying why, and nothing is sent", async () => {
  const page = await mount(ACME);

  await add(page, "lower_case", "Variable", "x");
  const badShape = page.querySelector('[role="alert"]')?.textContent;
  type(input(page, "Name"), "PATH");
  act(() => input(page, "Value").form?.requestSubmit());
  await settle();
  const reserved = page.querySelector('[role="alert"]')?.textContent;

  assert.equal(
    badShape,
    "Use capital letters, digits, and underscores, not starting with a digit.",
  );
  assert.equal(reserved, "PATH is set by the sandbox or Luke. Choose another name.");
  assert.deepEqual(saves(), []);
});

test("a multi-line secret, such as a certificate, is sent with its line breaks", async () => {
  const certificate = "-----BEGIN CERTIFICATE-----\nMIIBsynthetic\n-----END CERTIFICATE-----";
  const page = await mount(ACME);

  await add(page, "TLS_CERT", "Secret", certificate);

  assert.deepEqual(
    saves().map((request) => request.payload.secretValue),
    [certificate],
  );
});

test("a name or a value past the service's bounds is refused on the page, saying why, and nothing is sent", async () => {
  const page = await mount(ACME);

  await add(page, "A".repeat(129), "Variable", "x");
  const longName = page.querySelector('[role="alert"]')?.textContent;
  type(input(page, "Name"), "BIG");
  type(input(page, "Value"), "x".repeat(16_385));
  act(() => input(page, "Value").form?.requestSubmit());
  await settle();
  const longValue = page.querySelector('[role="alert"]')?.textContent;

  assert.equal(longName, "A name can be at most 128 characters.");
  assert.equal(longValue, "A value can be at most 16,384 characters.");
  assert.deepEqual(saves(), []);
});

test("a secret too short to be hidden is refused on the page, saying why, and nothing is sent", async () => {
  const page = await mount(ACME);

  await add(page, "PIN", "Secret", "123");

  assert.equal(
    page.querySelector('[role="alert"]')?.textContent,
    "A secret must be at least 4 characters, so it can be hidden in what commands print.",
  );
  assert.deepEqual(saves(), []);
});

test("a save past the workspace's bound says why and keeps the form open", async () => {
  tooMany = true;
  const page = await mount(ACME);

  await add(page, "ONE_MORE", "Variable", "x");

  assert.equal(
    page.querySelector('[role="alert"]')?.textContent,
    "This workspace already holds 100 variables and secrets. Remove one first.",
  );
  assert.ok(page.querySelector("form"), "the form stays open");
});

test("the group and its fields are kept out of the screen recording", async () => {
  const page = await mount(ACME);

  act(() => button(page, "Add variable or secret").click());

  assert.ok(
    page.querySelector(".ph-no-capture section"),
    "the group is under the unrecorded class",
  );
  assert.ok(input(page, "Value").classList.contains("ph-no-capture"));
});
