// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { accountActor } from "@luke/ui/actor-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { rendererRegistry } from "../renderer-runtime.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { AccountSection } from "./account-section.js";

/**
 * Settings › Profile names the signed-in account on the face every other
 * place draws it on: its picture where the sign-in carried one, and its
 * letter on its hue where it carried none, as the sidebar's foot and a
 * workspace's member list draw the same account. Synthetic accounts.
 */

type SignedIn = Parameters<typeof AccountSection>[0]["account"];

const ADA: SignedIn = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-ada",
  email: "ada@example.com",
  name: "Ada",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

/** `element` drawn, as a page to query. */
function drawn(element: React.ReactElement): HTMLElement {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(element);
  return page;
}

/** The face leading Profile's account row for `account`. */
function profileFace(account: SignedIn): Element | null {
  return drawn(
    createElement(AccountSection, {
      account,
      onSignOut: () => Promise.resolve(),
      onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    }),
  ).querySelector(".actor-mark");
}

/** The face the shared mark draws for the same account at a Settings row's size. */
function sharedFace(account: SignedIn): Element | null {
  return drawn(
    createElement(ActorMark, { actor: accountActor(account), size: ACTOR_SIZE.CARD }),
  ).querySelector(".actor-mark");
}

test("an account with no picture is its letter on its hue, the face the sidebar and the member list draw", () => {
  const face = profileFace(ADA);

  assert.equal(face?.textContent, "A");
  assert.equal(face?.outerHTML, sharedFace(ADA)?.outerHTML);
});

test("an account with a picture draws it on the same face", () => {
  const pictured: SignedIn = { ...ADA, pictureUrl: "https://lh3.googleusercontent.com/a/photo-9" };
  const face = profileFace(pictured);

  assert.equal(
    face?.querySelector<HTMLImageElement>(".actor-mark img")?.src,
    "https://lh3.googleusercontent.com/a/photo-9",
  );
  assert.equal(face?.outerHTML, sharedFace(pictured)?.outerHTML);
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** The section drawn with a toast host on the window's own registry, over a Sign out of the given answer. */
function mountSection(onSignOut: () => Promise<void>): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        rendererRegistry,
        createElement(
          Fragment,
          null,
          createElement(AccountSection, {
            account: ADA,
            onSignOut,
            onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
          }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  return { container, root };
}

const signOutButton = (within: ParentNode) =>
  [...within.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Sign out",
  ) ?? assert.fail("a Sign out button stands");

test("Sign out signs the account out on the press, with no question first", async () => {
  let signOuts = 0;
  const { container, root } = mountSection(() => {
    signOuts += 1;
    return Promise.resolve();
  });

  await act(async () => signOutButton(container).click());

  assert.equal(signOuts, 1);
  assert.equal(document.querySelector('[role="alertdialog"], [role="dialog"]'), null);
  act(() => root.unmount());
});

test("a Sign out the host refused says so in a toast, and the button is pressable again", async () => {
  const { container, root } = mountSection(() => Promise.reject(new Error("refused")));

  await act(async () => signOutButton(container).click());

  assert.match(
    document.body.textContent ?? "",
    /The account could not be signed out\. Try again\./u,
  );
  assert.equal(signOutButton(container).disabled, false);
  act(() => root.unmount());
});
