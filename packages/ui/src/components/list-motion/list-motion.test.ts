// @vitest-environment jsdom

import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LIST_MOTION_WAY, ListMotion, motionKey, motionRows, useLeaving } from "./list-motion.js";

/**
 * list-motion.test.ts -- a row arriving in a list slides in as it fades in,
 * a row leaving slides out where it stood and is let go once that has
 * played, a row listed again before it had gone stands again and comes back
 * the same way, a row moved from one list to another glides across rather
 * than leaving and arriving, and nothing plays where no motion is to play.
 * jsdom lays nothing out and plays nothing, so each row's place is given
 * and each motion recorded.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** How tall a row is drawn, and how far apart the lists stand, in the layout given. */
const ROW = 40;
const COLUMN = 200;

/** The motion tokens the lists read, as an app's sheets set them. */
const TOKENS = {
  "--luke-duration-exit": "90ms",
  "--luke-motion-exit": "ease",
  "--luke-duration-quick": "140ms",
  "--luke-duration-shape": "460ms",
  "--luke-spring": "ease-out",
  "--luke-row-stagger": "32ms",
  "--luke-list-travel": "16px",
} as const;

/** A motion played: the element, its keyframes and timing, and a way to have it finish. */
interface Played {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly timing: KeyframeAnimationOptions;
  readonly finish: () => void;
}

let root: Root | undefined;
let played: Played[] = [];

beforeEach(() => {
  played = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
      const motion = { onfinish: null as (() => void) | null, cancel: () => undefined };
      played.push({ element: this, keyframes, timing, finish: () => motion.onfinish?.() });
      return motion;
    },
  });
  // Note that each list stands in its own column, and each row under the rows before it still in the layout.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const list = this.parentElement;
    if (!this.matches("li") || list === null) return new DOMRect(0, 0, 0, 0);
    const laidOut = [...list.children].filter(
      (each) => each instanceof HTMLElement && each.style.position !== "absolute",
    );
    const column = [...(list.parentElement?.children ?? [])].indexOf(list);
    const top =
      this.style.position === "absolute"
        ? Number.parseFloat(this.style.top)
        : laidOut.indexOf(this) * ROW;
    return new DOMRect(column * COLUMN, top, COLUMN, ROW);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  Reflect.deleteProperty(Element.prototype, "animate");
  vi.restoreAllMocks();
});

/** One list's rows, each by its key, drawn on while it leaves. */
function Rows({ keys }: { keys: readonly string[] }): React.JSX.Element {
  const drawn = useLeaving(keys, (key) => key);
  return createElement(
    "ul",
    motionRows(),
    drawn.map(({ key }) => createElement("li", { key, ...motionKey(key) }, key)),
  );
}

/** Lists side by side, each by its rows' keys, under one motion where `moving`. */
function Lists({
  lists,
  moving,
}: {
  lists: readonly (readonly string[])[];
  moving: boolean;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const drawn = createElement(
    "div",
    { ref: box },
    lists.map((keys, at) => createElement(Rows, { key: String(at), keys })),
  );
  return moving ? createElement(ListMotion, { root: box, children: drawn }) : drawn;
}

/** Draws `lists`, the motion's tokens set where `tokens`, and hands back a way to draw others. */
function draw(
  lists: readonly (readonly string[])[],
  { moving = true, tokens = true }: { moving?: boolean; tokens?: boolean } = {},
): (next: readonly (readonly string[])[]) => void {
  if (tokens) {
    for (const [name, value] of Object.entries(TOKENS)) {
      document.documentElement.style.setProperty(name, value);
    }
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Lists, { lists, moving })));
  return (next) => act(() => root?.render(createElement(Lists, { lists: next, moving })));
}

/** The rows drawn, each list's keys in its order. */
function drawn(): string[][] {
  return [...document.querySelectorAll("ul")].map((list) =>
    [...list.children].map((row) => row.textContent ?? ""),
  );
}

/** The row of `key` drawn, and none where none is. */
function rowOf(key: string, leaving = false): Element | undefined {
  return [...document.querySelectorAll(`li`)].find(
    (row) => row.textContent === key && row.hasAttribute("data-leaving") === leaving,
  );
}

/** The motions played on `element`, by their keyframes. */
function motionsOf(element: Element | undefined): Keyframe[][] {
  return played.filter((each) => each.element === element).map((each) => each.keyframes);
}

test("nothing plays the first time a list is drawn", () => {
  draw([["A", "B"]]);

  expect(played).toEqual([]);
});

test("a row arriving fades in and slides in from the leading edge, and the row it pushed down glides from where it stood", () => {
  const show = draw([["A", "B"]]);

  show([["A", "N", "B"]]);

  expect(motionsOf(rowOf("N"))).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    [{ transform: "translateX(-16px)" }, { transform: "none" }],
  ]);
  expect(motionsOf(rowOf("B"))).toEqual([
    [{ transform: `translate(0px, ${-ROW}px)` }, { transform: "none" }],
  ]);
  expect(motionsOf(rowOf("A"))).toEqual([]);
});

test("rows arriving together arrive a stagger apart", () => {
  const show = draw([["A"]]);

  show([["A", "B", "C"]]);

  const delays = ["B", "C"].map(
    (key) => played.find((each) => each.element === rowOf(key))?.timing.delay,
  );
  expect(delays).toEqual([0, 32]);
});

test("a row leaving slides out out of reach where it stood, and the rows under it glide up after it has gone first", () => {
  const show = draw([["A", "B", "C"]]);

  show([["A", "C"]]);

  const leaving = rowOf("B", true);
  expect(leaving?.hasAttribute("inert")).toBe(true);
  expect((leaving as HTMLElement | undefined)?.style.top).toBe(`${ROW}px`);
  expect(motionsOf(leaving)).toEqual([
    [
      { opacity: "1", transform: "none" },
      { opacity: 0, transform: "translateX(-16px)" },
    ],
  ]);
  const glide = played.find((each) => each.element === rowOf("C"));
  expect(glide?.keyframes[0]).toEqual({ transform: `translate(0px, ${ROW}px)` });
  expect(glide?.timing.delay).toBe(90);
  expect(drawn()).toEqual([["A", "B", "C"]]);

  act(() => played.find((each) => each.element === leaving)?.finish());

  expect(drawn()).toEqual([["A", "C"]]);
});

test("a row listed again before its exit has played stands again, and comes back the way it went", () => {
  const show = draw([["A", "B", "C"]]);
  show([["A", "C"]]);
  const leaving = rowOf("B", true);
  played = [];

  show([["A", "B", "C"]]);

  const back = rowOf("B");
  expect(back).toBe(leaving);
  expect(back?.hasAttribute("inert")).toBe(false);
  expect((back as HTMLElement | undefined)?.style.position).toBe("");
  expect(motionsOf(back)).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    [{ transform: "translateX(-16px)" }, { transform: "none" }],
  ]);
});

test("a row moved into another list glides across from where it stood rather than leaving one and arriving in the other", () => {
  const show = draw([["A", "B"], ["C"]]);

  show([["A"], ["B", "C"]]);

  expect(drawn()).toEqual([["A"], ["B", "C"]]);
  expect(motionsOf(rowOf("B"))).toEqual([
    [{ transform: `translate(${-COLUMN}px, ${ROW}px)` }, { transform: "none" }],
  ]);
  expect(motionsOf(rowOf("C"))).toEqual([
    [{ transform: `translate(0px, ${-ROW}px)` }, { transform: "none" }],
  ]);
});

test("with no motion to play, a leaving row goes on the change that stopped listing it and nothing moves", () => {
  const show = draw([["A", "B", "C"]], { tokens: false });

  show([["A", "C"]]);

  expect(drawn()).toEqual([["A", "C"]]);
  expect(played).toEqual([]);
});

test("with no motion around it, a list lets a leaving row go at once", async () => {
  const show = draw([["A", "B"]], { moving: false });

  show([["A"]]);
  await act(async () => undefined);

  expect(drawn()).toEqual([["A"]]);
});

test("a list whose rows scale rather than slide scales a leaving row out where it stands", () => {
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  function Chips({ keys }: { keys: readonly string[] }): React.JSX.Element {
    const box = useRef<HTMLDivElement>(null);
    return createElement(ListMotion, {
      root: box,
      way: LIST_MOTION_WAY.SCALE,
      children: createElement("div", { ref: box }, createElement(Rows, { keys })),
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Chips, { keys: ["A", "B"] })));

  act(() => root?.render(createElement(Chips, { keys: ["A"] })));

  expect(motionsOf(rowOf("B", true))).toEqual([
    [
      { opacity: "1", transform: "none" },
      { opacity: 0, transform: "scale(0.6)" },
    ],
  ]);
});

test("a row leaving a list scrolled down holds the root as tall as its scroller shows it, through the property the root's minimum reads", () => {
  const show = draw([["A", "B", "C"]]);
  const box = document.querySelector<HTMLElement>("[data-motion-root]");
  const scroller = box?.parentElement;
  if (box === null || box === undefined || scroller === null || scroller === undefined) {
    throw new Error("the root and its scroller are drawn");
  }
  // Note that jsdom lays nothing out, so the scroller's place and the root's are given.
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 80 });
  Object.defineProperty(box, "offsetHeight", { configurable: true, value: 300 });
  Object.defineProperty(scroller, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 200, 120),
  });
  Object.defineProperty(box, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, -80, 200, 300),
  });

  show([["A", "B"]]);

  expect(box.style.getPropertyValue("--luke-list-held-height")).toBe("200px");
});
