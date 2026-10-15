// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { ACTOR_KIND, type Actor, SOMEONE_REASON } from "@luke/ui/actor-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { ActorRef } from "./actor-ref";
import { githubPageOf, OpenPersonProvider } from "./person-door";

/**
 * A press on a person goes where the window can take it: a member's page,
 * the page of someone who left, or a GitHub account's own page on GitHub,
 * and each card names the same door under its rule. Outside the window,
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
let github: string[] = [];

beforeEach(() => {
  opened = [];
  github = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act) => {
        if (request.kind === ACT_KIND.GITHUB_OPEN) github.push(request.payload.url);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
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
    ? createElement(OpenPersonProvider, { value: (userId: string) => opened.push(userId) }, element)
    : element;
  act(() => root?.render(onRegistry(AtomRegistry.make(), provided)));
  return container;
}

/** The actor's card, hung by resting on its name. */
function cardOf(view: HTMLElement): Element {
  const named = view.querySelector(".actor-ref") ?? assert.fail("the actor is named");
  act(() => {
    named.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return document.querySelector(".tooltip-card .card") ?? assert.fail("a card hangs");
}

function press(element: Element | null | undefined): void {
  assert.ok(element instanceof HTMLElement, "it stands");
  act(() => element.click());
}

test("a member's name is a press that opens their page, and their card says Open profile", () => {
  const view = draw(createElement(ActorRef, { actor: DANA }));
  const named = view.querySelector(".actor-ref");

  assert.equal(named?.tagName, "BUTTON");
  press(named);
  const door = cardOf(view).querySelector(".card-door");
  assert.equal(door?.textContent, "Open profile");
  press(door);

  assert.deepEqual(opened, ["user-dana", "user-dana"]);
});

test("someone who left opens their page by the account id the service still names them by", () => {
  const view = draw(createElement(ActorRef, { actor: LEE }));

  press(view.querySelector(".actor-ref"));
  assert.equal(cardOf(view).querySelector(".card-door")?.textContent, "Open profile");
  assert.deepEqual(opened, ["user-lee"]);
});

test("a GitHub account who is no member opens on GitHub, a person their profile and an App's bot its App's page", () => {
  const person = draw(createElement(ActorRef, { actor: OCTOCAT }));
  press(person.querySelector(".actor-ref"));
  assert.equal(cardOf(person).querySelector(".card-door")?.textContent, "Open on GitHub");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const bot = draw(createElement(ActorRef, { actor: DEPENDABOT }));
  press(bot.querySelector(".actor-ref"));

  assert.deepEqual(github, ["https://github.com/octocat", "https://github.com/apps/dependabot"]);
  assert.deepEqual(opened, []);
});

test("someone nobody names opens nothing, and outside the window nobody does", () => {
  const unnamed = draw(createElement(ActorRef, { actor: NOBODY }));
  assert.equal(unnamed.querySelector(".actor-ref")?.tagName, "SPAN");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const outside = draw(createElement(ActorRef, { actor: DANA }), false);
  assert.equal(outside.querySelector(".actor-ref")?.tagName, "SPAN");
  assert.equal(cardOf(outside).querySelector(".card-door"), null);
});

test("a place's own door wins over the person's", () => {
  let own = 0;
  const view = draw(createElement(ActorRef, { actor: DANA, onOpen: () => (own += 1) }));

  press(view.querySelector(".actor-ref"));

  assert.equal(own, 1);
  assert.deepEqual(opened, []);
});

test("a GitHub login with no App's suffix is a person's profile, even marked a bot", () => {
  assert.equal(githubPageOf("renovate", true), "https://github.com/renovate");
});
