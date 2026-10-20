// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@luke/features/github-token-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind } from "@luke/host/contract";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { AccountSection } from "./account-section.js";

/**
 * Settings › Profile's GitHub personal access token row and its dialog, over
 * a bridge answering as the host would: the row offers Add with no token and
 * Manage with one, drawn as its hint, login, and expiry; a pasted token is
 * sent once from an unrecorded password field; Remove asks first; a refused
 * save says why in a short label. Synthetic tokens.
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
/** How many of the next reads go unanswered. */
let unansweredReads = 0;

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = null;
  sent = [];
  refuseSave = undefined;
  unansweredReads = 0;
  fakeActPort({
    [ACT_KIND.GITHUB_TOKEN_READ]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_READ, payload });
      if (unansweredReads > 0) {
        unansweredReads -= 1;
        return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      }
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

/** Profile's account section, its token row read, with the dialog opened by the row's one button. */
async function mountAndOpen(open = true): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AccountSection, {
        account: {
          status: ACCOUNT_STATUS.SIGNED_IN,
          id: "user-ada",
          email: "ada@example.com",
          name: "Ada",
          provider: ACCOUNT_PROVIDER.GOOGLE,
        },
        onSignOut: () => Promise.resolve(),
        onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      }),
    ),
  );
  await settle();
  if (!open) return;
  act(() => button(stored === null ? "Add" : "Manage").click());
  await settle();
}

const dialog = () => document.querySelector('[role="dialog"]') ?? assert.fail("no dialog");

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

test("with no token the row offers Add, and a token pasted into the unrecorded field is sent once and drawn as the service's facts on the row", async () => {
  await mountAndOpen();
  assert.equal(dialog().querySelector("h2")?.textContent, "Personal access token");
  assert.match(dialog().textContent ?? "", /Create token/u);

  const input = tokenField() ?? assert.fail("no token field");
  assert.equal(input.type, "password");
  assert.ok(input.closest(".ph-no-capture"), "the field is kept out of the recording");
  await paste(PASTED);

  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_SAVE).map((each) => each.payload),
    [{ token: PASTED }],
  );
  assert.equal(tokenField(), null);
  act(() => button("Done").click());
  assert.match(
    document.body.textContent ?? "",
    /GitHub personal access tokenghp_…wxyz · octo-member · Expires /u,
  );
  button("Manage");
  assert.ok(!document.body.innerHTML.includes(PASTED), "the page holds the token nowhere");
});

test("a saved token's Manage opens it with Remove, which asks first, then takes it away", async () => {
  stored = KEPT;
  await mountAndOpen();
  assert.equal(tokenField(), null);

  act(() => button("Remove", dialog()).click());
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
  await mountAndOpen();
  await paste(PASTED);

  assert.equal(document.querySelector('[role="alert"]')?.textContent, "Not a classic token");
  assert.ok(tokenField(), "the field stands as pasted");
});

test("a read that went unanswered offers Try again in place of Add, which reads the token again", async () => {
  unansweredReads = 1;
  await mountAndOpen(false);
  assert.equal(
    [...document.querySelectorAll("button")].some((each) => each.textContent === "Add"),
    false,
  );

  act(() => button("Try again").click());
  await settle();
  button("Add");
});

test("the row reads the token again when Profile is drawn for another account", async () => {
  stored = KEPT;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (id: string) =>
    act(() =>
      root.render(
        createElement(AccountSection, {
          account: {
            status: ACCOUNT_STATUS.SIGNED_IN,
            id,
            email: `${id}@example.com`,
            name: id,
            provider: ACCOUNT_PROVIDER.GOOGLE,
          },
          onSignOut: () => Promise.resolve(),
          onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
        }),
      ),
    );
  draw("ada");
  await settle();
  button("Manage");

  stored = null;
  draw("bea");
  await settle();
  button("Add");
  assert.ok(!(container.textContent ?? "").includes("octo-member"), "Ada's token is gone");
});
