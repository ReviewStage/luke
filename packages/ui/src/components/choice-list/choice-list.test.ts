// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { BADGE_TONE } from "../badge/badge.js";
import {
  CHOICE_FLOW,
  CHOICE_LOOK,
  CHOICE_SELECT,
  CHOICE_TONE,
  ChoiceList,
  type ChoiceLook,
  type ChoiceOption,
  type ChoiceSelect,
} from "./choice-list.js";

/**
 * choice-list.test.ts -- a pick-one list is a radio group the arrows walk
 * past an unavailable row, a press on its checked row keeping or clearing
 * the choice as asked; a pick-several list toggles each row on its own, the
 * arrows moving along it; a marked and numbered list
 * leads each row with its control and wears its key; a read-only list
 * keeps the open look, its pick checked, and takes no press, key, or Tab;
 * and a settled list names what was picked and takes no press.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

type Retry = "three" | "once" | "never";

const OPTIONS: readonly ChoiceOption<Retry>[] = [
  { value: "three", label: "Retry 3 times", detail: "Over an hour.", badge: "Recommended" },
  { value: "once", label: "Retry once", detail: "Can't retry: the queue is full.", disabled: true },
  { value: "never", label: "Never retry" },
];

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A list whose value its caller holds, every change it was handed listed after it. */
function Held({
  select,
  options = OPTIONS,
  clearable = false,
  disabled = false,
  start = [],
  look,
  numbered,
  readOnly = false,
}: {
  select?: ChoiceSelect;
  options?: readonly ChoiceOption<Retry>[];
  clearable?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  start?: readonly Retry[];
  look?: ChoiceLook;
  numbered?: boolean;
}): React.JSX.Element {
  const [value, setValue] = useState<readonly Retry[]>(start);
  const [heard, setHeard] = useState<string[]>([]);
  return createElement(
    "div",
    null,
    createElement(ChoiceList<Retry>, {
      legend: "Retries",
      options,
      value,
      select,
      clearable,
      disabled,
      readOnly,
      look,
      numbered,
      onChange: (next: readonly Retry[]) => {
        setValue(next);
        setHeard((all) => [...all, next.join("+") || "none"]);
      },
    }),
    createElement("output", null, heard.join(",")),
  );
}

function rows(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>("button")];
}

function row(page: HTMLElement, label: string): HTMLButtonElement {
  return (
    rows(page).find((each) => each.textContent?.startsWith(label)) ?? assert.fail(`no ${label}`)
  );
}

function heard(page: HTMLElement): string | null | undefined {
  return page.querySelector("output")?.textContent;
}

function key(element: Element, name: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

test("a pick-one list is a radio group named by its legend, each row a radio checked while it is the value", () => {
  const page = render(createElement(Held, { start: ["never"] }));
  const group = page.querySelector('[role="radiogroup"]');
  assert.equal(group?.getAttribute("aria-label"), "Retries");
  assert.deepEqual(
    rows(page).map((each) => [each.getAttribute("role"), each.getAttribute("aria-checked")]),
    [
      ["radio", "false"],
      ["radio", "false"],
      ["radio", "true"],
    ],
  );
  assert.equal(row(page, "Retry 3 times").textContent, "Retry 3 timesRecommendedOver an hour.");
});

test("Tab lands on the checked row alone, or the first open one while none is checked", () => {
  const tabStops = (page: HTMLElement) =>
    rows(page)
      .filter((each) => each.tabIndex === 0)
      .map((each) => each.textContent?.slice(0, 11));
  assert.deepEqual(tabStops(render(createElement(Held, { start: ["never"] }))), ["Never retry"]);
  assert.deepEqual(tabStops(render(createElement(Held))), ["Retry 3 tim"]);
});

test("the arrows choose the next open row, past an unavailable one, wrapping at either end, and take the keyboard there", () => {
  const page = render(createElement(Held, { start: ["three"] }));
  const three = row(page, "Retry 3 times");
  act(() => three.focus());
  key(three, "ArrowDown");
  assert.equal(document.activeElement, row(page, "Never retry"));
  key(row(page, "Never retry"), "ArrowDown");
  assert.equal(document.activeElement, three);
  key(three, "ArrowUp");
  assert.equal(heard(page), "never,three,never");
  assert.equal(row(page, "Retry once").disabled, true);
});

test("a press chooses a row; a press on the checked row keeps it, unless the list is clearable", () => {
  const kept = render(createElement(Held));
  act(() => row(kept, "Never retry").click());
  act(() => row(kept, "Never retry").click());
  assert.equal(heard(kept), "never");

  const cleared = render(createElement(Held, { clearable: true }));
  act(() => row(cleared, "Never retry").click());
  act(() => row(cleared, "Never retry").click());
  assert.equal(heard(cleared), "never,none");
  assert.equal(row(cleared, "Never retry").getAttribute("aria-checked"), "false");
});

test("an open row's badge stands in the attention tone unless the option names its own", () => {
  const page = render(
    createElement(ChoiceList<Retry>, {
      legend: "Retries",
      options: [
        { value: "three", label: "Retry 3 times", badge: "Recommended" },
        { value: "never", label: "Never retry", badge: "Quiet", badgeTone: BADGE_TONE.NEUTRAL },
      ],
      value: [],
      onChange: () => undefined,
    }),
  );
  const tones = [...page.querySelectorAll(".luke-badge")].map((badge) => [
    badge.textContent,
    badge.getAttribute("data-tone"),
  ]);
  assert.deepEqual(tones, [
    ["Recommended", BADGE_TONE.ATTENTION],
    ["Quiet", BADGE_TONE.NEUTRAL],
  ]);
});

test("a press on the checked row is heard by a list that listens for it, and changes nothing", () => {
  const pressed: string[] = [];
  const page = render(
    createElement(ChoiceList<Retry>, {
      legend: "Retries",
      options: OPTIONS,
      value: ["never"],
      onChange: (next: readonly Retry[]) => pressed.push(`change:${next.join("+")}`),
      onPressChecked: (value: Retry) => pressed.push(`again:${value}`),
    }),
  );
  act(() => row(page, "Never retry").click());
  act(() => row(page, "Retry 3 times").click());
  assert.deepEqual(pressed, ["again:never", "change:three"]);
});

test("after a clearable list's pick is taken back, the arrows step from the row the keyboard is on", () => {
  const page = render(createElement(Held, { clearable: true }));
  const never = row(page, "Never retry");
  act(() => never.focus());
  act(() => never.click());
  act(() => never.click());
  key(never, "ArrowDown");
  assert.equal(heard(page), "never,none,three");
  assert.equal(document.activeElement, row(page, "Retry 3 times"));
});

test("a pick-several list is a group of checkboxes, each its own Tab stop, toggled on its own", () => {
  const page = render(createElement(Held, { select: CHOICE_SELECT.MANY }));
  assert.equal(page.querySelector("fieldset")?.getAttribute("aria-label"), "Retries");
  assert.deepEqual(
    rows(page).map((each) => [each.getAttribute("role"), each.tabIndex]),
    [
      ["checkbox", 0],
      ["checkbox", 0],
      ["checkbox", 0],
    ],
  );
  act(() => row(page, "Retry 3 times").click());
  act(() => row(page, "Never retry").click());
  act(() => row(page, "Retry 3 times").click());
  assert.equal(heard(page), "three,three+never,never");
  assert.equal(row(page, "Never retry").getAttribute("aria-checked"), "true");
});

test("the arrows move the keyboard along a pick-several list, past an unavailable row and wrapping at either end, and toggle nothing", () => {
  const page = render(createElement(Held, { select: CHOICE_SELECT.MANY }));
  const three = row(page, "Retry 3 times");
  act(() => three.focus());
  key(three, "ArrowDown");
  assert.equal(document.activeElement, row(page, "Never retry"));
  key(row(page, "Never retry"), "ArrowRight");
  assert.equal(document.activeElement, three);
  key(three, "ArrowUp");
  assert.equal(document.activeElement, row(page, "Never retry"));
  assert.equal(heard(page), "");
});

test("a marked list leads each row with the radio or the checkbox it behaves as, and a numbered one wears each row's number after its badge and names it as the row's key", () => {
  const controls = (page: HTMLElement) =>
    rows(page).map((each) =>
      each.querySelector(".luke-choice-control")?.getAttribute("data-shape"),
    );
  assert.deepEqual(controls(render(createElement(Held, { look: CHOICE_LOOK.MARKED }))), [
    "radio",
    "radio",
    "radio",
  ]);
  const boxes = render(
    createElement(Held, { look: CHOICE_LOOK.MARKED, select: CHOICE_SELECT.MANY, numbered: true }),
  );
  assert.deepEqual(controls(boxes), ["box", "box", "box"]);
  assert.deepEqual(
    rows(boxes).map((each) => each.getAttribute("aria-keyshortcuts")),
    ["1", "2", "3"],
  );
  assert.equal(row(boxes, "Retry 3 times").textContent, "Retry 3 timesRecommended1Over an hour.");
  const plain = render(createElement(Held));
  assert.deepEqual(controls(plain), [undefined, undefined, undefined]);
  assert.deepEqual(
    rows(plain).map((each) => each.getAttribute("aria-keyshortcuts")),
    [null, null, null],
  );
});

test("a list across stands its rows side by side, each toned row filling its checked control with what picking it means, and still picks one by the arrows", () => {
  function Decide(): React.JSX.Element {
    const [value, setValue] = useState<readonly string[]>([]);
    return createElement(ChoiceList<string>, {
      legend: "Decision",
      options: [
        { value: "yes", label: "Approve", tone: CHOICE_TONE.COMPLETE },
        { value: "no", label: "Decline", tone: CHOICE_TONE.DANGER },
      ],
      value,
      look: CHOICE_LOOK.MARKED,
      flow: CHOICE_FLOW.ACROSS,
      onChange: setValue,
    });
  }
  const page = render(createElement(Decide));
  assert.equal(page.querySelector('[role="radiogroup"]')?.getAttribute("data-flow"), "across");
  assert.deepEqual(
    rows(page).map((each) => each.dataset.tone),
    ["complete", "danger"],
  );
  act(() => row(page, "Approve").focus());
  key(row(page, "Approve"), "ArrowRight");
  assert.equal(row(page, "Decline").getAttribute("aria-checked"), "true");
});

test("a pill list draws its options as pills, a check before the picked one's words, and picks as a radio group does", () => {
  const page = render(createElement(Held, { look: CHOICE_LOOK.PILL, start: ["never"] }));
  assert.equal(page.querySelector('[role="radiogroup"]')?.getAttribute("data-look"), "pill");
  assert.deepEqual(
    rows(page).map((each) => each.querySelector(".luke-choice-check") !== null),
    [true, true, true],
  );
  act(() => row(page, "Never retry").focus());
  key(row(page, "Never retry"), "ArrowDown");
  assert.equal(heard(page), "three");
});

test("an unavailable list changes nothing, by press or by key", () => {
  const page = render(createElement(Held, { disabled: true, start: ["three"] }));
  act(() => row(page, "Never retry").click());
  key(row(page, "Retry 3 times"), "ArrowDown");
  assert.equal(heard(page), "");
});

test("a read-only list keeps the open look with its pick checked, its badge in the neutral tone, and takes no press, key, or Tab", () => {
  for (const select of [CHOICE_SELECT.ONE, CHOICE_SELECT.MANY]) {
    const page = render(
      createElement(Held, { select, readOnly: true, look: CHOICE_LOOK.MARKED, start: ["three"] }),
    );
    const list = page.querySelector<HTMLElement>(".luke-choice-list") ?? assert.fail("no list");
    assert.equal(list.dataset.readOnly, "true");
    assert.equal(list.dataset.look, "marked", "each row still leads with its control");
    assert.deepEqual(
      rows(page).map((each) => [each.getAttribute("aria-checked"), each.disabled]),
      [
        ["true", true],
        ["false", true],
        ["false", true],
      ],
    );
    assert.equal(page.querySelector<HTMLElement>(".luke-badge")?.dataset.tone, "neutral");
    act(() => row(page, "Never retry").click());
    key(row(page, "Retry 3 times"), "ArrowDown");
    assert.equal(heard(page), "", "nothing is handed on");
  }
  const page = render(createElement(Held, { readOnly: true, start: ["never"] }));
  assert.equal(page.querySelector('[role="radiogroup"]')?.getAttribute("aria-readonly"), "true");
});

test("a settled list names each option, the pick beside its note and the rest without, and offers nothing to press", () => {
  const page = render(
    createElement(ChoiceList<Retry>, {
      legend: "What was offered",
      options: OPTIONS,
      value: ["never"],
      settled: true,
      pickedNote: "Your pick",
    }),
  );
  const list = page.querySelector("ul") ?? assert.fail("no list");
  assert.equal(list.getAttribute("aria-label"), "What was offered");
  assert.deepEqual(
    [...list.querySelectorAll("li")].map((each) => each.textContent),
    [
      "Retry 3 timesRecommendedOver an hour.",
      "Retry onceCan't retry: the queue is full.",
      "Never retryYour pick",
    ],
  );
  assert.equal(rows(page).length, 0);
});

test("a picture list is a radio group of faces the arrows walk, each face's picture its mark", () => {
  const container = render(
    createElement(Held, {
      look: CHOICE_LOOK.PICTURE,
      start: ["three"],
      options: [
        { value: "three", label: "Atlas", mark: createElement("img", { alt: "", src: "a.png" }) },
        { value: "never", label: "Orion", mark: createElement("img", { alt: "", src: "o.png" }) },
      ],
    }),
  );
  const group = container.querySelector('[role="radiogroup"]');
  assert.equal(group?.getAttribute("data-look"), "picture");
  const faces = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.deepEqual(
    faces.map((face) => face.textContent),
    ["Atlas", "Orion"],
  );
  assert.ok(faces[0]?.querySelector(".luke-choice-mark img"));
  act(() => faces[0]?.focus());
  act(() => {
    faces[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  assert.equal(faces[1]?.getAttribute("aria-checked"), "true");
  assert.equal(document.activeElement, faces[1]);
});

test("a card list holds each option's controls under its radio, and a key pressed in them is theirs", () => {
  const container = render(
    createElement(Held, {
      look: CHOICE_LOOK.CARD,
      start: ["three"],
      options: [
        {
          value: "three",
          label: "Subscription",
          aside: createElement("a", { href: "#key" }, "Get key"),
          below: createElement("input", { "aria-label": "Token" }),
        },
        { value: "never", label: "API key" },
      ],
    }),
  );
  const cards = [...container.querySelectorAll(".luke-choice-card")];
  assert.equal(cards.length, 2);
  assert.ok(cards[0]?.querySelector(".luke-choice-aside a"));
  const input = cards[0]?.querySelector("input");
  assert.ok(input);
  assert.equal(input.closest('[role="radio"]'), null);
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const radios = [...container.querySelectorAll('[role="radio"]')];
  assert.equal(radios[0]?.getAttribute("aria-checked"), "true");
  assert.equal(radios[1]?.getAttribute("aria-checked"), "false");
});
