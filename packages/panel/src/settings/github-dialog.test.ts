// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@repo/features/github-token-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind } from "@repo/host/contract";
import type { SettingsLink } from "@repo/settings/settings-views";
import { holdExits } from "@repo/ui/testing/held-exits";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState, holdGitHubToken } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { AccountSection } from "./account-section.js";

/**
 * Settings › Profile's GitHub personal access token row and its dialog, over
 * a bridge answering as the host would, the token held on app state and each
 * write's answer laid there: the row offers Add with no token and
 * Manage with one, drawn as its hint, login, and expiry; a pasted token is
 * sent once from an unrecorded password field; Disconnect asks first; a refused
 * save says why in a short label. Synthetic tokens.
 */

const PASTED = "synthetic-classic-token-0000000000wxyz";

/** The account signed in, whose token the host holds. */
const ADA = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-ada",
  email: "ada@example.com",
  name: "Ada",
  provider: ACCOUNT_PROVIDER.GOOGLE,
} as const;

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
/** Lays the token on the window's document, as the host lays its read and each write's answer. */
let layToken: () => void = () => undefined;
/** Every place in Settings the window was asked to open, in order. */
let opened: SettingsLink[] = [];

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = null;
  sent = [];
  refuseSave = undefined;
  unansweredReads = 0;
  opened = [];
  handState({}, { account: ADA });
  // Note that the token is laid as the host holds it, and a write's answer is laid before it answers.
  layToken = holdGitHubToken(() => {
    if (unansweredReads === 0) return { rows: { token: stored } };
    unansweredReads -= 1;
    return { failed: true };
  }).lay;
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.GITHUB_TOKEN_SAVE]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_SAVE, payload });
      if (refuseSave !== undefined) return Promise.resolve({ token: stored, rejected: refuseSave });
      stored = KEPT;
      layToken();
      return Promise.resolve({ token: stored });
    },
    [ACT_KIND.GITHUB_TOKEN_REMOVE]: (payload) => {
      sent.push({ kind: ACT_KIND.GITHUB_TOKEN_REMOVE, payload });
      stored = null;
      layToken();
      return Promise.resolve({ token: null });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  releaseMotion();
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
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
      onRegistry(
        AtomRegistry.make(),
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => opened.push(link) },
          createElement(AccountSection, {
            account: ADA,
            onSignOut: () => Promise.resolve(),
            onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
          }),
        ),
      ),
    ),
  );
  await settle();
  if (!open) return;
  act(() => button(stored === null ? "Add" : "Manage").click());
  await settle();
}

const dialog = () => document.querySelector('[role="dialog"]') ?? assert.fail("no dialog");

/** The field its visible label names, as a reader finds it. */
const tokenField = () => {
  const label = [...document.querySelectorAll("label")].find(
    (each) => each.textContent === "Personal access token",
  );
  return label?.control instanceof HTMLInputElement ? label.control : null;
};

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
    /GitHub personal access tokenghp_…wxyz\u00a0·\u00a0octo-member Expires\u00a0/u,
  );
  button("Manage");
  assert.ok(!document.body.innerHTML.includes(PASTED), "the page holds the token nowhere");
});

test("a token's expiry is one unbreakable unit and no fact on the row's line carries a dot at its edge", async () => {
  stored = KEPT;
  await mountAndOpen(false);
  const facts = [
    ...(document.querySelector(".ui-settings-row-description .ui-inline")?.children ?? []),
  ].map((each) => each.textContent ?? "");
  const expiry = facts.find((each) => each.startsWith("Expires"));
  assert.match(expiry ?? "", /^Expires\u00a0[A-Z][a-z]{2}\u00a0\d{1,2},\u00a0\d{4} $/u);
  assert.deepEqual(
    facts.filter((each) => /^·|·$/u.test(each)),
    [],
  );
});

test("the dialog opens with the token field focused, and Disconnect's question going back to a form leaves it there", async () => {
  await mountAndOpen();
  assert.ok(document.activeElement === tokenField(), "the field takes focus as the card opens");
  await paste(PASTED);
  act(() => button("Done").click());
  await settle();

  act(() => button("Manage").click());
  await settle();
  assert.equal(tokenField(), null);
  act(() => {
    button("Disconnect", dialog()).focus();
    button("Disconnect", dialog()).click();
  });
  await settle();
  act(() =>
    button(
      "Disconnect token",
      dialog().querySelector<HTMLElement>('[role="group"]') ?? dialog(),
    ).click(),
  );
  await settle();
  assert.ok(document.activeElement === tokenField(), "the form drawn again has focus");
});

test("a saved token's Manage opens it with Disconnect, which asks at the dialog's foot, then takes it away", async () => {
  stored = KEPT;
  await mountAndOpen();
  assert.equal(tokenField(), null);
  const asked = () => dialog().querySelector<HTMLElement>('[role="group"]');

  // Note that the press is made from Disconnect holding focus, as a pointer's or a key's press is.
  act(() => {
    button("Disconnect", dialog()).focus();
    button("Disconnect", dialog()).click();
  });
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 0);
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "no card opens over it");
  const question = asked() ?? assert.fail("no question at the foot");
  assert.match(question.textContent ?? "", /Disconnect your GitHub token\?/u);
  // The question has a one-line body saying what goes.
  assert.match(question.textContent ?? "", /Vespin deletes the token it holds/u);
  assert.doesNotMatch(dialog().textContent ?? "", /Create token|Done/u, "the foot is the question");
  assert.ok(document.activeElement === button("Cancel", question), "Cancel takes focus");

  act(() => button("Cancel", question).click());
  await settle();
  assert.equal(asked(), null, "Cancel takes the question back");
  assert.match(dialog().textContent ?? "", /Create token/u, "and the dialog stays");
  assert.ok(
    document.activeElement === button("Disconnect", dialog()),
    "focus goes back to Disconnect",
  );

  act(() => button("Disconnect", dialog()).click());
  await settle();
  act(() => button("Disconnect token", asked() ?? assert.fail()).click());
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 1);
  assert.ok(tokenField(), "the field stands again");
});

test("each refused save says why and what to do next, and keeps the field", async () => {
  await mountAndOpen();
  const said = new Map<string, string | undefined>();
  for (const rejection of Object.values(GITHUB_TOKEN_REJECTION)) {
    refuseSave = rejection;
    await paste(PASTED);
    said.set(
      rejection,
      document.getElementById(tokenField()?.getAttribute("aria-describedby") ?? "")?.textContent ??
        undefined,
    );
    assert.ok(tokenField(), "the field stands as pasted");
  }

  assert.deepEqual(Object.fromEntries(said), {
    fine_grained: "This isn't a classic token. Create a classic token and paste that.",
    invalid: "GitHub rejected this token. Check that you copied all of it, or create a new one.",
    no_repo_scope: "This token is missing the repo scope. Create a new token with repo ticked.",
    unreachable: "GitHub could not be reached. Try again.",
    too_many_tries: "Too many tokens tried in the last hour. Try again later.",
  });
});

test("a saved token GitHub rejected says to disconnect it and add a new one", async () => {
  stored = { ...KEPT, status: GITHUB_TOKEN_STATUS.INVALID };
  await mountAndOpen();

  assert.match(
    dialog().textContent ?? "",
    /GitHub rejected this token\. Disconnect it and add a new one\./u,
  );
});

test("a saved token Vespin can no longer read says to disconnect it and add it again", async () => {
  stored = { ...KEPT, status: GITHUB_TOKEN_STATUS.UNREADABLE };
  await mountAndOpen();

  assert.match(
    dialog().textContent ?? "",
    /Can no longer be read\. Disconnect it and add it again\./u,
  );
});

test("a read that went unanswered says so as an alert with Retry in place of Add, which reads the token again", async () => {
  unansweredReads = 1;
  await mountAndOpen(false);
  assert.equal(
    [...document.querySelectorAll("button")].some((each) => each.textContent === "Add"),
    false,
  );
  assert.equal(
    document.querySelector('[role="alert"]')?.textContent,
    "The token could not be read.Retry",
  );

  act(() => button("Retry").click());
  await settle();
  button("Add");
});

test("the row draws no other account's token when Profile is drawn for another account", async () => {
  stored = KEPT;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (id: string) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
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
      ),
    );
  draw(ADA.id);
  await settle();
  button("Manage");

  draw("user-bea");
  await settle();
  assert.equal(
    [...container.querySelectorAll("button")].some((each) => each.textContent === "Manage"),
    false,
  );
  assert.ok(!(container.textContent ?? "").includes("octo-member"), "Ada's token is gone");
});

/** The token dialog opened from the row's Add, which held focus as it was pressed, and then put away by its Done. */
async function openedThenDone(): Promise<HTMLButtonElement> {
  await mountAndOpen(false);
  const opener = button("Add");
  opener.focus();
  act(() => opener.click());
  await settle();
  act(() => button("Done").click());
  return opener;
}

test("Done fades the token dialog out, still drawn and in its ending state, then takes it away with focus back on its button", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  const opener = await openedThenDone();
  const fading = document.querySelector('[role="dialog"]');
  act(() => vi.advanceTimersToNextFrame());
  const stillDrawn = document.querySelector('[role="dialog"]') !== null;
  await act(async () => exits.finish());

  assert.ok(fading, "the dialog stands while it fades");
  assert.equal(stillDrawn, true, "it stays until its fade has run");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener, "focus is back on the button that opened it");
});

test("Done takes the token dialog away at once where motion is held", async () => {
  holdExits();
  holdMotion();
  const opener = await openedThenDone();

  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener);
});
