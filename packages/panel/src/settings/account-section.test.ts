// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { accountActor } from "@repo/ui/actor-model";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { rendererRegistry } from "../renderer-runtime.js";
import { onRegistry, withQueryClient } from "../testing/copy-feedback.js";
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
    withQueryClient(
      createElement(AccountSection, {
        account,
        onSignOut: () => Promise.resolve(),
      }),
    ),
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

/** A workspace of the account's, by name, role, and member count, as the Workspace page lists it. */
const workspaceOf = (name: string, role: Workspace["role"], memberCount: number): Workspace => ({
  id: `workspace-${name}`,
  name,
  role,
  github: null,
  memberCount,
});

const deleteButton = (within: ParentNode) =>
  [...within.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Delete account",
  ) ?? assert.fail("a Delete account button stands");

test("Delete account names the workspaces the account owns and is the only member of as going with it", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      withQueryClient(
        createElement(AccountSection, {
          account: ADA,
          workspaces: [
            workspaceOf("Ada", WORKSPACE_ROLE.OWNER, 1),
            workspaceOf("Acme", WORKSPACE_ROLE.MEMBER, 3),
          ],
          onSignOut: () => Promise.resolve(),
        }),
      ),
    ),
  );

  await act(async () => deleteButton(container).click());

  const asked = document.body.textContent ?? "";
  assert.match(asked, /Also deleted, with everything in them: Ada\./u);
  assert.doesNotMatch(asked, /Acme/u);
  act(() => root.unmount());
});
