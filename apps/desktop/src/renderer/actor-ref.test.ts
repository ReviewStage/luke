// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  githubLoginActor,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { ACTOR_SIZE, ActorMark, ActorRef, ActorStack } from "./actor-ref";

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
  document.head.innerHTML = "";
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
  act(() => picture.dispatchEvent(new Event("load")));
  assert.equal(face().textContent, "");
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
    { kind: ACTOR_KIND.GITHUB, login: "octocat", bot: false },
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
    ["person", "luke", "agent", "automation", "someone", "github"],
  );
  assert.ok(marks.every((mark) => mark.getAttribute("aria-hidden") === "true"));
  assert.ok(view.querySelector('[data-kind="luke"] .luke-face'), "Luke wears his face");
});

test("an agent whose harness is not known yet stands on an empty box, named by the words beside it", () => {
  const view = draw(
    createElement(
      "p",
      null,
      createElement(ActorRef, { actor: AGENT }),
      createElement(ActorRef, {
        actor: { ...AGENT, name: "Ship invites", provider: MODEL_PROVIDER.ANTHROPIC },
      }),
    ),
  );
  const [waiting, known] = [...view.querySelectorAll('.actor-mark[data-kind="agent"]')].map(
    (mark) => mark.querySelector(".state-glyph > :is(svg, img)") ?? assert.fail("a box stands"),
  );
  assert.ok(waiting && known);

  assert.equal(waiting.childElementCount, 0, "the box draws no glyph");
  assert.ok(known.classList.contains("harness-mark"), "a known harness wears its mark");
  assert.equal(view.querySelector(".actor-ref-name")?.textContent, "Fix auth flow");
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

/** The words of the card an actor named in a line hangs once the pointer rests on its name. */
function cardOf(actor: Actor): Element {
  const view = draw(createElement(ActorRef, { actor }));
  const named = view.querySelector(".actor-ref") ?? assert.fail("the actor is named");
  act(() => {
    named.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return (
    document.querySelector('.tooltip-card [data-actor-card="github"]') ??
    assert.fail("a card hangs")
  );
}

test("someone on GitHub stands by their avatar, a person on a circle with their letter until it loads, and an App's bot on a square with its robot, never a letter", () => {
  const avatar = "https://avatars.githubusercontent.com/u/1";
  const view = draw(
    createElement(
      "div",
      null,
      createElement(ActorMark, {
        actor: { kind: ACTOR_KIND.GITHUB, login: "octocat", bot: false, avatarUrl: avatar },
      }),
      createElement(ActorMark, {
        actor: {
          kind: ACTOR_KIND.GITHUB,
          login: "devin-ai-integration[bot]",
          bot: true,
          avatarUrl: avatar,
        },
      }),
    ),
  );
  const [person, bot] = [...view.querySelectorAll<HTMLElement>('.actor-mark[data-kind="github"]')];
  assert.ok(person && bot);
  assert.equal(person.querySelector(".actor-face")?.textContent, "O");
  assert.equal(bot.querySelector(".actor-face")?.textContent, "", "a bot's square holds no letter");
  assert.ok(bot.querySelector(".lucide-bot"), "a bot wears its robot until its avatar loads");
  const picture = bot.querySelector("img") ?? assert.fail("the avatar is asked for");
  act(() => picture.dispatchEvent(new Event("load")));
  assert.equal(
    bot.querySelector(".lucide-bot"),
    null,
    "the avatar stands in the robot's place once loaded",
  );
});

test("someone on GitHub hangs a card saying who they are there and that a person is no member here, an App's bot that it is an app, and opens nothing", () => {
  const person = cardOf({ kind: ACTOR_KIND.GITHUB, login: "octocat", bot: false });
  assert.equal(person.querySelector(".card-name")?.textContent, "@octocat");
  assert.equal(person.querySelector(".card-sub")?.textContent, "GitHub user");
  assert.equal(person.querySelector(".card-corner")?.textContent, "Not in this workspace");
  assert.equal(document.querySelector('.actor-ref[data-kind="github"]')?.tagName, "SPAN");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const bot = cardOf({ kind: ACTOR_KIND.GITHUB, login: "devin-ai-integration[bot]", bot: true });
  assert.equal(
    bot.querySelector(".card-name .actor-card-name")?.firstChild?.textContent,
    "devin-ai-integration",
  );
  assert.equal(bot.querySelector(".card-name .actor-bot")?.textContent, "bot");
  assert.equal(bot.querySelector(".card-sub")?.textContent, "GitHub app");
  assert.equal(bot.querySelector(".card-corner"), null);
  assert.equal(document.querySelector(".actor-ref-name")?.textContent, "devin-ai-integration");
});

test("a picture GitHub serves is asked for at twice the size its disc is drawn", () => {
  const avatar = "https://avatars.githubusercontent.com/u/1?v=4";
  const view = draw(
    createElement(
      "div",
      null,
      createElement(ActorMark, {
        actor: { kind: ACTOR_KIND.GITHUB, login: "octocat", bot: false, avatarUrl: avatar },
        size: ACTOR_SIZE.STACK,
      }),
      createElement(ActorMark, {
        actor: { ...DANA, pictureUrl: avatar },
        size: ACTOR_SIZE.CARD,
      }),
      createElement(ActorMark, {
        actor: { ...DANA, pictureUrl: "https://lh3.googleusercontent.com/a/photo" },
        size: ACTOR_SIZE.CARD,
      }),
    ),
  );

  assert.deepEqual(
    [...view.querySelectorAll("img")].map((picture) => picture.getAttribute("src")),
    [
      "https://avatars.githubusercontent.com/u/1?v=4&s=36",
      "https://avatars.githubusercontent.com/u/1?v=4&s=64",
      "https://lh3.googleusercontent.com/a/photo",
    ],
  );
});

test("an App's bot on GitHub stands by its App's avatar and wears a quiet bot badge after its name, in a line, a card, and the count's card, and a person on GitHub wears none", () => {
  const avatar = "https://avatars.githubusercontent.com/in/29110?v=4";
  const dependabot: Actor = {
    kind: ACTOR_KIND.GITHUB,
    login: "dependabot[bot]",
    bot: true,
    avatarUrl: avatar,
  };
  const octocat: Actor = { kind: ACTOR_KIND.GITHUB, login: "octocat", bot: false };
  const view = draw(
    createElement(
      "p",
      null,
      createElement(ActorRef, { actor: dependabot }),
      createElement(ActorRef, { actor: octocat }),
      createElement(ActorRef, { actor: { kind: ACTOR_KIND.LUKE } }),
    ),
  );
  const [bot, person, luke] = [...view.querySelectorAll<HTMLElement>(".actor-ref")];

  assert.equal(bot?.querySelector("img")?.getAttribute("src"), `${avatar}&s=32`);
  assert.equal(bot?.querySelector(".actor-ref-name")?.textContent, "dependabot");
  assert.equal(bot?.querySelector(".actor-bot")?.textContent, "bot");
  assert.equal(person?.querySelector(".actor-bot"), null, "a person wears no badge");
  assert.equal(luke?.querySelector(".actor-bot"), null, "Luke reads as Luke");

  act(() => root?.unmount());
  document.body.innerHTML = "";
  const pile = draw(
    createElement(ActorStack, {
      actors: [DANA, octocat, dependabot],
      faces: [{}, {}, { says: "Commented" }],
      drawn: 2,
      label: "Reviewers",
    }),
  );
  act(() => {
    pile
      .querySelector(".actor-stack-more")
      ?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const row =
    document.querySelector('.tooltip-card [data-actor-card="more"] .actor-more-row') ??
    assert.fail("the count's card names the rest");
  assert.equal(
    row.textContent,
    "dependabot\u00a0bot · Commented",
    "the badge keeps to its name's line",
  );
});

test("a person GitHub names by login alone stands by the avatar GitHub serves for that login, and by their letter where it fails, while a bot named so keeps its robot", () => {
  const view = draw(
    createElement(
      "div",
      null,
      createElement(ActorMark, { actor: githubLoginActor("octocat") }),
      createElement(ActorMark, { actor: githubLoginActor("devin-ai-integration[bot]") }),
    ),
  );
  const [person, bot] = [...view.querySelectorAll<HTMLElement>(".actor-mark")];
  const picture = person?.querySelector("img") ?? assert.fail("the avatar is asked for");

  assert.equal(
    picture.getAttribute("src"),
    "https://avatars.githubusercontent.com/octocat?v=4&s=32",
  );
  act(() => picture.dispatchEvent(new Event("error")));
  assert.equal(person?.querySelector("img"), null);
  assert.equal(person?.querySelector(".actor-face")?.textContent, "O");
  assert.equal(bot?.querySelector("img"), null, "a bot's login names no picture of its App's");
  assert.ok(bot?.querySelector(".lucide-bot"));
});

test("a member who left keeps their own face, their picture or else their letter, and a screen reader hears that they left", () => {
  const picture = "https://lh3.googleusercontent.com/a/photo-7";
  const lee: Actor = {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Lee Park",
    userId: "user-lee",
    pictureUrl: picture,
  };
  const unpictured: Actor = {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Lee Park",
    userId: "user-lee",
  };
  const view = draw(
    createElement(
      "p",
      null,
      createElement(ActorRef, { actor: lee }),
      createElement(ActorMark, { actor: unpictured }),
    ),
  );
  const [withPicture, withLetter] = [...view.querySelectorAll<HTMLElement>(".actor-mark")];

  assert.equal(withPicture?.querySelector("img")?.getAttribute("src"), picture);
  assert.equal(withLetter?.querySelector(".actor-face")?.textContent, "L");
  assert.equal(view.querySelector(".actor-ref")?.textContent, "LLee Park (former member)");
});

test("a facepile of faces with cards names a member who left as one to a screen reader, as their grayed face cannot", () => {
  const lee: Actor = {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Lee Park",
    userId: "user-lee",
  };
  const view = draw(
    createElement(ActorStack, {
      actors: [lee, SAM],
      drawn: 2,
      faces: [{}, {}],
      label: "Reviewers",
    }),
  );

  assert.deepEqual(
    [...view.querySelectorAll(".actor-stack-face")].map((face) => face.getAttribute("aria-label")),
    ["Lee Park (former member)", "Sam Okafor"],
  );
});
