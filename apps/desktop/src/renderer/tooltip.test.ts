// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MOTION_DELAY_MS } from "@sidecar/surface";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, type ButtonHTMLAttributes, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { Tooltip } from "./tooltip";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** The page's clock, which the pill reads to know whether it finished waiting. It only rises, as the page's does. */
let now = 0;

let root: Root | undefined;

function button(props: ButtonHTMLAttributes<HTMLButtonElement>, text?: string) {
  return createElement("button", { type: "button", ...props }, text);
}

/** Two neighbouring icon buttons and a labeled one, as a toolbar holds them. */
function mountToolbar(): void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(
        "div",
        null,
        createElement(Tooltip, {
          label: "Hide sidebar",
          command: APP_COMMAND.TOGGLE_SIDEBAR,
          children: button({ "aria-label": "Hide sidebar" }),
        }),
        createElement(Tooltip, {
          label: "Plan actions",
          children: button({ "aria-label": "Plan actions" }),
        }),
        createElement(Tooltip, {
          label: "Settings",
          command: APP_COMMAND.SETTINGS,
          children: button({}, "Dean Stratakos"),
        }),
      ),
    );
  });
}

function control(name: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  assert.ok(button, `no ${name} control`);
  return button;
}

function pill(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="tooltip"]');
}

/** The pointer arriving on a control, as React hears it. */
function hover(name: string): void {
  act(() => {
    control(name).dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
}

/** The pointer leaving a control for nowhere in particular. */
function leave(name: string): void {
  act(() => {
    control(name).dispatchEvent(
      new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    );
  });
}

function rest(milliseconds: number): void {
  now += milliseconds;
}

/** The pointer moving from one place to another, as React hears it: out of the first, over the second. */
function cross(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}

/** Advances the clock a card's linger waits on, then lets what fell due land and redraw. */
const advance = (millis: number) =>
  Effect.andThen(
    TestClock.adjust(Duration.millis(millis)),
    Effect.promise(() =>
      act(async () => {
        for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
      }),
    ),
  );

/** What the card a tab hangs says. */
const CARD_WORDS = "Fix the flaky test, working for 3m";

/**
 * What the window's one tooltip says, while one stands. Note that a test
 * compares words rather than elements, because a failed comparison of two
 * elements prints the whole page.
 */
function says(): string | undefined {
  return pill()?.textContent ?? undefined;
}

/** A tab that hangs a card, beside a plain icon button, on the test's clock. */
function mountCardBeside(registry: AtomRegistry): void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      onRegistry(
        registry,
        createElement(
          "div",
          null,
          createElement(Tooltip, {
            label: "Fix the flaky test",
            card: createElement("p", null, CARD_WORDS),
            children: button({}, "Fix the flaky test"),
          }),
          createElement(Tooltip, {
            label: "New tab",
            children: button({ "aria-label": "New tab" }),
          }),
        ),
      ),
    );
  });
}

/** The card on screen, past its wait. */
function shownCard(): HTMLElement {
  hover("Fix the flaky test");
  rest(MOTION_DELAY_MS.HINT);
  const card = pill();
  assert.ok(card, "no card");
  return card;
}

beforeEach(() => {
  // Each test starts long after the last, so no warm spell carries over.
  now += 60_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
  vi.restoreAllMocks();
});

test("resting on a control shows a pill naming it and its chord, and leaving takes it down", () => {
  mountToolbar();
  assert.equal(pill(), null);

  hover("Hide sidebar");
  assert.equal(pill()?.textContent, "Hide sidebar⌘B");
  assert.equal(control("Hide sidebar").getAttribute("aria-keyshortcuts"), "Meta+B");
  // The pill is the control's own name, so it is not said to a reader twice.
  assert.equal(control("Hide sidebar").getAttribute("aria-describedby"), null);

  leave("Hide sidebar");
  assert.equal(pill(), null);
});

test("a pill waits out the rest the first time, and the next one shows at once while the pointer keeps moving", () => {
  mountToolbar();

  hover("Hide sidebar");
  assert.equal(pill()?.dataset.instant, "false");
  rest(MOTION_DELAY_MS.HINT);
  leave("Hide sidebar");

  hover("Plan actions");
  assert.equal(pill()?.dataset.instant, "true", "a neighbour shows at once");
  leave("Plan actions");

  rest(MOTION_DELAY_MS.HINT * 2);
  hover("Hide sidebar");
  assert.equal(pill()?.dataset.instant, "false", "a pointer that paused waits again");
});

test("a pill that never finished waiting leaves the next to wait too", () => {
  mountToolbar();

  hover("Hide sidebar");
  rest(MOTION_DELAY_MS.HINT / 2);
  leave("Hide sidebar");
  hover("Plan actions");
  assert.equal(pill()?.dataset.instant, "false");
});

test("a press, a key, and a scroll each take the pill down, and Escape still reaches the window", () => {
  mountToolbar();
  const reached: string[] = [];
  const onKey = (event: KeyboardEvent) => reached.push(event.key);
  window.addEventListener("keydown", onKey);

  hover("Plan actions");
  act(() => {
    control("Plan actions").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  assert.equal(pill(), null);

  hover("Hide sidebar");
  rest(MOTION_DELAY_MS.HINT);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(pill(), null);
  assert.deepEqual(reached, ["Escape"]);

  leave("Hide sidebar");
  hover("Hide sidebar");
  act(() => {
    document.dispatchEvent(new Event("scroll"));
  });
  assert.equal(pill(), null);
  window.removeEventListener("keydown", onKey);
});

test("focus the keyboard moved shows the pill, and focus a press gave does not", () => {
  mountToolbar();

  act(() => control("Plan actions").focus());
  assert.equal(pill(), null);
  act(() => control("Plan actions").blur());

  document.documentElement.dataset.keyboard = "true";
  act(() => control("Plan actions").focus());
  assert.equal(pill()?.textContent, "Plan actions");
  act(() => control("Plan actions").blur());
  assert.equal(pill(), null);
});

test("a pill that says more than its control's name describes it", () => {
  mountToolbar();

  hover("Dean Stratakos");
  const shown = pill();
  assert.ok(shown);
  assert.equal(control("Dean Stratakos").getAttribute("aria-describedby"), shown.id);
  assert.equal(control("Dean Stratakos").getAttribute("aria-keyshortcuts"), "Meta+,");
});

test("a pill hangs below its control, and above it where the window ends", () => {
  mountToolbar();
  const anchor = control("Plan actions");
  const at = (top: number) =>
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, top, 30, 30));

  at(10);
  hover("Plan actions");
  assert.equal(pill()?.dataset.side, "below");
  leave("Plan actions");

  at(window.innerHeight - 30);
  hover("Plan actions");
  assert.equal(pill()?.dataset.side, "above");
});

test("a card hangs in the pill's place from its control's start, describes it, and is left out of the recording", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(Tooltip, {
        label: "Sign-out button",
        card: createElement("p", null, "Sign-out button in account menu"),
        children: button({}, "Sign-out button"),
      }),
    );
  });
  const anchor = control("Sign-out button");
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 10, 120, 30));

  hover("Sign-out button");
  const card = pill();
  assert.ok(card);
  assert.equal(card.textContent, "Sign-out button in account menu");
  assert.ok(card.classList.contains("ph-no-capture"));
  assert.equal(anchor.getAttribute("aria-describedby"), card.id);
  // jsdom draws the card no wider than nothing, so a centred pill would stand at the control's middle.
  assert.equal(card.style.left, "200px");
});

test("a card too wide for the room past its control's start is drawn whole inside the window, by its size before its fade", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(Tooltip, {
        label: "Fix the flaky test",
        card: createElement("p", null, "Fix the flaky test"),
        children: button({}, "Fix the flaky test"),
      }),
    );
  });
  const anchor = control("Fix the flaky test");
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
    new DOMRect(window.innerWidth - 120, 10, 120, 30),
  );
  // Its fade starts it scaled short, which its box would say and its layout does not.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute("role") === "tooltip" ? 280 : 0;
  });

  hover("Fix the flaky test");
  assert.equal(pill()?.style.left, `${window.innerWidth - 280 - 6}px`);
});

test("a card hung beside its control stands past the control's end, level with its top, and held inside the window", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(
        "div",
        null,
        createElement(Tooltip, {
          label: "Teammate invitations",
          card: createElement("p", null, "Teammate invitations"),
          cardBeside: true,
          children: button({}, "Teammate invitations"),
        }),
        createElement(Tooltip, {
          label: "Billing export",
          card: createElement("p", null, "Billing export"),
          cardBeside: true,
          children: button({}, "Billing export"),
        }),
      ),
    );
  });
  vi.spyOn(control("Teammate invitations"), "getBoundingClientRect").mockReturnValue(
    new DOMRect(8, 100, 240, 40),
  );
  vi.spyOn(control("Billing export"), "getBoundingClientRect").mockReturnValue(
    new DOMRect(8, window.innerHeight - 30, 240, 40),
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute("role") === "tooltip" ? 200 : 0;
  });

  hover("Teammate invitations");
  assert.equal(pill()?.dataset.side, "end");
  assert.equal(pill()?.style.left, `${8 + 240 + 6}px`);
  assert.equal(pill()?.style.top, "100px");
  leave("Teammate invitations");

  hover("Billing export");
  assert.equal(pill()?.style.top, `${window.innerHeight - 200 - 6}px`);
});

it.effect(
  "a card stays while the pointer crosses from its control onto it, and goes a moment after the pointer leaves it",
  () =>
    Effect.gen(function* () {
      mountCardBeside(yield* registryOnTestClock);
      const card = shownCard();

      cross(control("Fix the flaky test"), card);
      yield* advance(5_000);
      assert.equal(says(), CARD_WORDS, "the pointer on the card keeps it standing");

      cross(card, document.body);
      yield* advance(100);
      assert.equal(says(), CARD_WORDS, "it lingers a moment");
      yield* advance(100);
      assert.equal(pill(), null);
    }),
);

it.effect(
  "a card lingers when the pointer leaves its control, and the pointer coming back keeps it",
  () =>
    Effect.gen(function* () {
      mountCardBeside(yield* registryOnTestClock);
      const card = shownCard();

      leave("Fix the flaky test");
      yield* advance(100);
      assert.equal(says(), CARD_WORDS, "it lingers for the pointer crossing to it");
      hover("Fix the flaky test");
      yield* advance(5_000);
      assert.equal(says(), CARD_WORDS);

      cross(card, control("Fix the flaky test"));
      yield* advance(5_000);
      assert.equal(says(), CARD_WORDS, "back on its control from the card");

      leave("Fix the flaky test");
      yield* advance(200);
      assert.equal(pill(), null);
    }),
);

it.effect("a card still waiting goes at once with the pointer, as a pill does", () =>
  Effect.gen(function* () {
    mountCardBeside(yield* registryOnTestClock);

    hover("Fix the flaky test");
    rest(MOTION_DELAY_MS.HINT / 2);
    leave("Fix the flaky test");
    assert.equal(pill(), null);
  }),
);

it.effect("another control's hint takes a lingering card down at once, so one stands", () =>
  Effect.gen(function* () {
    mountCardBeside(yield* registryOnTestClock);
    shownCard();

    cross(control("Fix the flaky test"), control("New tab"));
    const shown = [...document.body.querySelectorAll('[role="tooltip"]')];
    assert.deepEqual(
      shown.map((each) => each.textContent),
      ["New tab"],
    );
    yield* advance(200);
    assert.equal(says(), "New tab", "the card's linger takes nothing else down");
  }),
);

it.effect(
  "a key leaves a card the pointer is on standing, Escape takes it down, and a press on it keeps it",
  () =>
    Effect.gen(function* () {
      mountCardBeside(yield* registryOnTestClock);
      const anchor = control("Fix the flaky test");
      document.documentElement.dataset.keyboard = "true";
      act(() => anchor.focus());
      rest(MOTION_DELAY_MS.HINT);
      const card = pill();
      assert.ok(card);

      cross(anchor, card);
      act(() => {
        card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        anchor.blur();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true }));
      });
      assert.equal(says(), CARD_WORDS);

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      assert.equal(pill(), null);
    }),
);

it.effect(
  "a selection dragged past a card's edge leaves it standing until the press ends, and then it lingers",
  () =>
    Effect.gen(function* () {
      mountCardBeside(yield* registryOnTestClock);
      const card = shownCard();
      cross(control("Fix the flaky test"), card);

      act(() => {
        card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      });
      cross(card, document.body);
      yield* advance(5_000);
      assert.equal(says(), CARD_WORDS, "the press still selecting holds it");

      act(() => {
        window.dispatchEvent(new MouseEvent("pointerup"));
      });
      yield* advance(100);
      assert.equal(says(), CARD_WORDS);
      yield* advance(100);
      assert.equal(says(), undefined);
    }),
);

it.effect(
  "choosing a button on a card takes the card down, and a press on its words does not",
  () =>
    Effect.gen(function* () {
      const chosen: string[] = [];
      const registry = yield* registryOnTestClock;
      const container = document.body.appendChild(document.createElement("div"));
      root = createRoot(container);
      act(() => {
        root?.render(
          onRegistry(
            registry,
            createElement(Tooltip, {
              label: "Fix the flaky test",
              card: createElement(
                "div",
                null,
                createElement("p", null, CARD_WORDS),
                button({ onClick: () => chosen.push("#128") }, "#128 · Retry the upload"),
              ),
              children: button({}, "Fix the flaky test"),
            }),
          ),
        );
      });
      const card = shownCard();
      cross(control("Fix the flaky test"), card);

      act(() => card.querySelector("p")?.click());
      assert.equal(
        says(),
        `${CARD_WORDS}#128 · Retry the upload`,
        "a press on the words leaves it standing",
      );
      act(() => control("#128 · Retry the upload").click());
      assert.deepEqual(chosen, ["#128"]);
      assert.equal(says(), undefined);
    }),
);
