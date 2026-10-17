// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { accountActor } from "@luke/ui/actor-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { AccountSection } from "./account-section";

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

  assert.equal(face?.querySelector(".actor-face")?.textContent, "A");
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
