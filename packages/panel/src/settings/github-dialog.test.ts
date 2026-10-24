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
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { holdExits } from "@luke/ui/testing/held-exits";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
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
  releaseMotion();
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
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
      createElement(
        OpenSettingsProvider,
        { value: (link: SettingsLink) => opened.push(link) },
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
    /GitHub personal access tokenghp_…wxyz · octo-member · Expires /u,
  );
  button("Manage");
  assert.ok(!document.body.innerHTML.includes(PASTED), "the page holds the token nowhere");
});

test("the dialog opens with the token field focused, and Remove's question going back to a form leaves it there", async () => {
  await mountAndOpen();
  assert.ok(document.activeElement === tokenField(), "the field takes focus as the card opens");
  await paste(PASTED);
  act(() => button("Done").click());
  await settle();

  act(() => button("Manage").click());
  await settle();
  assert.equal(tokenField(), null);
  act(() => {
    button("Remove", dialog()).focus();
    button("Remove", dialog()).click();
  });
  await settle();
  act(() =>
    button("Remove", dialog().querySelector<HTMLElement>('[role="group"]') ?? dialog()).click(),
  );
  await settle();
  assert.ok(document.activeElement === tokenField(), "the form drawn again has focus");
});

test("a saved token's Manage opens it with Remove, which asks at the dialog's foot, then takes it away", async () => {
  stored = KEPT;
  await mountAndOpen();
  assert.equal(tokenField(), null);
  const asked = () => dialog().querySelector<HTMLElement>('[role="group"]');

  // Note that the press is made from Remove holding focus, as a pointer's or a key's press is.
  act(() => {
    button("Remove", dialog()).focus();
    button("Remove", dialog()).click();
  });
  await settle();
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.GITHUB_TOKEN_REMOVE).length, 0);
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "no card opens over it");
  const question = asked() ?? assert.fail("no question at the foot");
  assert.match(question.textContent ?? "", /Remove your GitHub token\?/u);
  // The question has a one-line body saying what goes.
  assert.match(question.textContent ?? "", /Luke deletes the token he holds/u);
  assert.doesNotMatch(dialog().textContent ?? "", /Create token|Done/u, "the foot is the question");
  assert.ok(document.activeElement === button("Cancel", question), "Cancel takes focus");

  act(() => button("Cancel", question).click());
  await settle();
  assert.equal(asked(), null, "Cancel takes the question back");
  assert.match(dialog().textContent ?? "", /Create token/u, "and the dialog stays");
  assert.ok(document.activeElement === button("Remove", dialog()), "focus goes back to Remove");

  act(() => button("Remove", dialog()).click());
  await settle();
  assert.equal(button("Remove", asked() ?? assert.fail()).dataset.variant, "danger");
  act(() => button("Remove", asked() ?? assert.fail()).click());
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
    no_github_account:
      "No GitHub account is connected to your Luke account. Connect GitHub in Integrations settings, then save the token again.",
    other_user:
      "This token belongs to a different GitHub account than the one connected to Luke. Create it while signed in to the connected account.",
    unreachable: "GitHub could not be reached. Try again.",
    too_many_tries: "Too many tokens tried in the last hour. Try again later.",
  });
});

test("a save refused for want of a GitHub account names Integrations by a link that opens it", async () => {
  await mountAndOpen();
  refuseSave = GITHUB_TOKEN_REJECTION.NO_GITHUB_ACCOUNT;
  await paste(PASTED);
  const line =
    document.getElementById(tokenField()?.getAttribute("aria-describedby") ?? "") ??
    assert.fail("no line says why");
  assert.doesNotMatch(line.textContent ?? "", /›/u, "no path to the page is spelled");
  act(() => button("Integrations", line).click());
  assert.deepEqual(opened, [{ page: SETTINGS_VIEW.INTEGRATIONS }]);
});

test("a saved token GitHub rejected says to remove it and add a new one", async () => {
  stored = { ...KEPT, status: GITHUB_TOKEN_STATUS.INVALID };
  await mountAndOpen();

  assert.match(
    dialog().textContent ?? "",
    /GitHub rejected this token\. Remove it and add a new one\./u,
  );
});

test("a saved token Luke can no longer read says to remove it and add it again", async () => {
  stored = { ...KEPT, status: GITHUB_TOKEN_STATUS.UNREADABLE };
  await mountAndOpen();

  assert.match(dialog().textContent ?? "", /Can no longer be read\. Remove it and add it again\./u);
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
  const ending = fading?.hasAttribute("data-ending-style");
  act(() => vi.advanceTimersToNextFrame());
  const stillDrawn = document.querySelector('[role="dialog"]') !== null;
  await act(async () => exits.finish());

  assert.ok(fading, "the dialog stands while it fades");
  assert.equal(ending, true, "it is in its ending state");
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
