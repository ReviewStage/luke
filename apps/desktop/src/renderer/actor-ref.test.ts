// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACTOR_KIND, ACTOR_STATE, type Actor, SOMEONE_REASON } from "@luke/ui/actor-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { ActorMark, ActorRef, ActorStack } from "./actor-ref";

/**
 * Whoever did something is drawn one way: a person by their picture once it
 * loads and their letter until then, Luke, an agent, and an automation each
 * by their own mark, someone unnamed by an outline; named in a line, an
 * actor with a page is a press that opens it and a person is not; a
 * facepile counts the rest only where asked. Synthetic people.
 */

const PICTURE = "https://avatars.githubusercontent.com/u/9";
const DANA: Actor = {
  kind: ACTOR_KIND.PERSON,
  userId: "user-dana",
  name: "Dana Reyes",
  you: false,
};
const SAM: Actor = { kind: ACTOR_KIND.PERSON, userId: "user-sam", name: "Sam Okafor", you: false };
const LEE: Actor = { kind: ACTOR_KIND.PERSON, userId: "user-lee", name: "Lee Park", you: false };
const AGENT: Actor = {
  kind: ACTOR_KIND.AGENT,
  name: "Fix auth flow",
  provider: undefined,
  state: ACTOR_STATE.REST,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function draw(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

test("a person stands as their letter until their picture loads, and as the picture once it has", () => {
  const view = draw(createElement(ActorMark, { actor: { ...DANA, pictureUrl: PICTURE } }));
  const face = () => view.querySelector(".actor-face") ?? assert.fail("a face stands");
  const picture = view.querySelector("img") ?? assert.fail("the picture is asked for");

  assert.equal(face().textContent, "D");
  assert.equal(picture.dataset.loaded, "false");
  act(() => picture.dispatchEvent(new Event("load")));
  assert.equal(face().textContent, "");
  assert.equal(picture.dataset.loaded, "true");
});

test("a picture that fails leaves the letter standing", () => {
  const view = draw(createElement(ActorMark, { actor: { ...DANA, pictureUrl: PICTURE } }));
  act(() => view.querySelector("img")?.dispatchEvent(new Event("error")));

  assert.equal(view.querySelector("img"), null);
  assert.equal(view.querySelector(".actor-face")?.textContent, "D");
});

test("each kind of actor stands on its own kind of mark, which a screen reader skips for the name beside it", () => {
  const actors: Actor[] = [
    DANA,
    { kind: ACTOR_KIND.LUKE },
    AGENT,
    { kind: ACTOR_KIND.AUTOMATION, name: "Morning triage", state: ACTOR_STATE.REST },
    { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.FORMER, name: "Lee Park" },
  ];
  const view = draw(
    createElement(
      "div",
      null,
      actors.map((actor, index) => createElement(ActorMark, { key: index, actor })),
    ),
  );
  const marks = [...view.querySelectorAll<HTMLElement>(".actor-mark")];

  assert.deepEqual(
    marks.map((mark) => mark.dataset.kind),
    ["person", "luke", "agent", "automation", "someone"],
  );
  assert.ok(marks.every((mark) => mark.getAttribute("aria-hidden") === "true"));
  assert.ok(view.querySelector('[data-kind="luke"] .luke-face'), "Luke wears his face");
});

test("an actor with a page is a press that opens it, and a person's name is words in the line", () => {
  let opened = 0;
  const view = draw(
    createElement(
      "p",
      null,
      createElement(ActorRef, { actor: AGENT, onOpen: () => (opened += 1) }),
      createElement(ActorRef, { actor: { ...DANA, you: true }, sentence: true, possessive: true }),
    ),
  );
  const [agent, person] = [...view.querySelectorAll<HTMLElement>(".actor-ref")];

  assert.equal(agent?.tagName, "BUTTON");
  act(() => agent?.click());
  assert.equal(opened, 1);
  assert.equal(person?.tagName, "SPAN");
  assert.equal(person?.textContent, "Dyour");
});

test("a facepile draws its first few and counts the rest only where its words do not", () => {
  const counted = draw(createElement(ActorStack, { actors: [DANA, SAM, LEE], drawn: 2 }));
  assert.equal(counted.querySelectorAll(".actor-mark").length, 2);
  assert.equal(counted.querySelector(".actor-stack-more")?.textContent, "+1");
  act(() => root?.unmount());

  const uncounted = draw(
    createElement(ActorStack, { actors: [DANA, SAM, LEE], drawn: 2, counted: false }),
  );
  assert.equal(uncounted.querySelector(".actor-stack-more"), null);
});
