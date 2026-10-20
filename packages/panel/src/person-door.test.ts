// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { ACTOR_KIND, type Actor, SOMEONE_REASON } from "@luke/ui/actor-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ActorRef } from "./actor-ref.js";
import { MemberDirectory } from "./member-directory.js";
import { githubPageOf, OpenPersonProvider } from "./person-door.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * A press on a person goes where the window can take it: a member's page,
 * the page of someone who left, or a GitHub account's own page on GitHub;
 * a card is read, never a door. Outside the window,
 * where nobody provides the opener, a person opens nothing. Synthetic people.
 */

const DANA: Actor = {
  kind: ACTOR_KIND.PERSON,
  userId: "user-dana",
  name: "Dana Reyes",
  you: false,
};
const LEE: Actor = {
  kind: ACTOR_KIND.SOMEONE,
  reason: SOMEONE_REASON.FORMER,
  name: "Lee Park",
  userId: "user-lee",
};
const OCTOCAT: Actor = { kind: ACTOR_KIND.GITHUB, login: "octocat", bot: false };
const DEPENDABOT: Actor = { kind: ACTOR_KIND.GITHUB, login: "dependabot[bot]", bot: true };
const NOBODY: Actor = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };

let root: Root | undefined;
/** Every page the window was asked to open, and every address handed to GitHub. */
let opened: string[] = [];
/** The name each page was opened with, where the place knew one. */
let names: (string | undefined)[] = [];
/** The workspace each page was opened in, where the place named one. */
let workspaces: (string | undefined)[] = [];
let github: string[] = [];

beforeEach(() => {
  opened = [];
  names = [];
  workspaces = [];
  github = [];
  fakeAppPlatform(DESKTOP_LINKS);
  fakeActPort({
    [ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      github.push(url);
      return Promise.resolve();
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function draw(element: ReactElement, inWindow = true): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const provided = inWindow
    ? createElement(
        OpenPersonProvider,
        {
          value: (userId: string, name?: string, workspaceId?: string) => {
            opened.push(userId);
            names.push(name);
            workspaces.push(workspaceId);
          },
        },
        element,
      )
    : element;
  act(() => root?.render(onRegistry(AtomRegistry.make(), provided)));
  return container;
}

/** The actor's card, hung by resting on its name. */
function cardOf(view: HTMLElement): Element {
  const named = view.querySelector("[data-actor-ref]") ?? assert.fail("the actor is named");
  act(() => {
    named.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return (
    document.querySelector(".luke-tooltip-card .luke-hover-card") ?? assert.fail("a card hangs")
  );
}

function press(element: Element | null | undefined): void {
  assert.ok(element instanceof HTMLElement, "it stands");
  act(() => element.click());
}

test("a member's name is a press that opens their page, and their card is read, never a door", () => {
  const view = draw(createElement(ActorRef, { actor: DANA }));
  const named = view.querySelector("[data-actor-ref]");

  assert.equal(named?.tagName, "BUTTON");
  press(named);
  assert.equal(cardOf(view).querySelector("button"), null);

  assert.deepEqual(opened, ["user-dana"]);
});

test("someone who left opens their page by the account id the service still names them by, with the name the place knows", () => {
  const view = draw(createElement(ActorRef, { actor: LEE }));

  press(view.querySelector("[data-actor-ref]"));
  assert.deepEqual(opened, ["user-lee"]);
  assert.deepEqual(names, ["Lee Park"]);
});

test("a GitHub account who is no member opens on GitHub, a person their profile and an App's bot its App's page", () => {
  const person = draw(createElement(ActorRef, { actor: OCTOCAT }));
  press(person.querySelector("[data-actor-ref]"));
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const bot = draw(createElement(ActorRef, { actor: DEPENDABOT }));
  press(bot.querySelector("[data-actor-ref]"));

  assert.deepEqual(github, ["https://github.com/octocat", "https://github.com/apps/dependabot"]);
  assert.deepEqual(opened, []);
});

test("someone nobody names opens nothing, and outside the window nobody does", () => {
  const unnamed = draw(createElement(ActorRef, { actor: NOBODY }));
  assert.equal(unnamed.querySelector("[data-actor-ref]")?.tagName, "SPAN");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const outside = draw(createElement(ActorRef, { actor: DANA }), false);
  assert.equal(outside.querySelector("[data-actor-ref]")?.tagName, "SPAN");
});

test("a place's own door wins over the person's", () => {
  let own = 0;
  const view = draw(createElement(ActorRef, { actor: DANA, onOpen: () => (own += 1) }));

  press(view.querySelector("[data-actor-ref]"));

  assert.equal(own, 1);
  assert.deepEqual(opened, []);
});

test("a GitHub login with no App's suffix is a person's profile, even marked a bot", () => {
  assert.equal(githubPageOf("renovate", true), "https://github.com/renovate");
});

test("a person named inside a workspace's members opens in that workspace, an agent's own where its page stands in another", () => {
  const view = draw(
    createElement(MemberDirectory, {
      workspace: { id: "workspace-acme" },
      readerId: "user-sam",
      children: createElement(ActorRef, { actor: DANA }),
    }),
  );

  press(view.querySelector("[data-actor-ref]"));

  assert.deepEqual(workspaces, ["workspace-acme"]);
});
