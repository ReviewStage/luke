// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@luke/features/github-token-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind } from "@luke/host/contract";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { GitHubDialog } from "./github-dialog.js";

/**
 * Settings › Integrations › GitHub › Manage over a bridge answering as the
 * host would: the dialog opens on the App, or on the token where one is
 * saved; a pasted token is sent once and drawn as the service's hint, login,
 * and expiry; opening the App removes nothing; a refused save says why in a
 * short label. Synthetic tokens.
 */

const PASTED = "synthetic-classic-token-0000000000wxyz";

const KEPT: GitHubTokenSummary = {
  login: "octo-member",
  hint: "ghp_…wxyz",
  status: GITHUB_TOKEN_STATUS.VERIFIED,
  statusAt: Date.UTC(2026, 9, 19, 12),
  addedAt: Date.UTC(2026, 9, 19, 12),
  expiresAt: Date.UTC(2026, 11, 18, 12),
};

/** The token the test's service holds. */
let stored: GitHubTokenSummary | null = null;
/** Every act the dialog sent, in order. */
let sent: { kind: PortActKind; payload: unknown }[] = [];
/** Why the service keeps nothing of the next save, where it refuses one. */
let refuseSave: GitHubTokenRejection | undefined;
/** How many times the dialog asked the integrations to be read again. */
let refreshes = 0;

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = null;
  sent = [];
  refuseSave = undefined;
  refreshes = 0;
  fakeActPort({
    [ACT_KIND.GITHUB_TOKEN_READ]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_READ, payload });
      return Promise.resolve({ token: stored });
    },
    [ACT_KIND.GITHUB_TOKEN_SAVE]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_SAVE, payload });
      if (refuseSave !== undefined) return Promise.resolve({ token: stored, rejected: refuseSave });
      stored = KEPT;
      return Promise.resolve({ token: stored });
    },
    [ACT_KIND.GITHUB_TOKEN_REMOVE]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_REMOVE, payload });
      stored = null;
      return Promise.resolve({ token: null });
    },
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

async function mount(connected = true): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(GitHubDialog, {
        connected,
        onRefresh: () => {
          refreshes += 1;
          return Promise.resolve();
        },
        onClose: () => undefined,
      }),
    ),
  );
  await settle();
}

const radio = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((each) =>
    each.textContent?.startsWith(label),
  ) ?? assert.fail(`no ${label} option`);

const checked = () => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent;

const tokenField = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Personal access token"]');

const button = (words: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words,
  ) ?? assert.fail(`no ${words} button`);

async function paste(token: string): Promise<void> {
  const input = tokenField() ?? assert.fail("no token field");
  act(() => {
    // Note that the value goes through the element's own setter, as typing does, so React hears it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, token);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.form?.requestSubmit());
  await settle();
}

test("the dialog opens on the App; a token pasted into the unrecorded field is sent once and drawn as the service's facts, and opening the App removes nothing", async () => {
  await mount();
  assert.match(checked() ?? "", /^Luke GitHub AppRecommended/u);
  assert.equal(tokenField(), null);

  act(() => radio("Personal access token").click());
  const input = tokenField() ?? assert.fail("no token field");
  assert.equal(input.type, "password");
  assert.ok(input.closest(".ph-no-capture"), "the field is kept out of the recording");
  await paste(PASTED);

  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_SAVE).map((each) => each.payload),
    [{ token: PASTED }],
  );
  assert.equal(tokenField(), null);
  assert.match(document.body.textContent ?? "", /ghp_…wxyz · octo-member · Expires /u);
  assert.ok(!document.body.innerHTML.includes(PASTED), "the dialog holds the token nowhere");

  act(() => radio("Luke GitHub App").click());
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 0);
});

test("the dialog opens on a saved token, and Remove asks first, then takes it away", async () => {
  stored = KEPT;
  await mount();
  assert.match(checked() ?? "", /^Personal access token/u);

  act(() => button("Remove").click());
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 0);
  const question =
    document.querySelector('[role="alertdialog"]') ?? assert.fail("no confirm dialog");
  act(() => button("Remove", question).click());
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 1);
  assert.ok(tokenField(), "the field stands again");
});

test("a refused save says why in a short label and keeps the field", async () => {
  refuseSave = GITHUB_TOKEN_REJECTION.FINE_GRAINED;
  await mount();
  act(() => radio("Personal access token").click());
  await paste(PASTED);

  assert.equal(document.querySelector('[role="alert"]')?.textContent, "Not a classic token");
  assert.ok(tokenField(), "the field stands as pasted");
});

test("the App's panel says whether GitHub is connected, and Refresh reads it again", async () => {
  await mount(false);
  assert.match(document.body.textContent ?? "", /Not connected/u);
  act(() => button("Refresh").click());
  await settle();
  assert.equal(refreshes, 1);
});
