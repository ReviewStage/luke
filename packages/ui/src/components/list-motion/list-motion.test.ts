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
 * than leaving and arriving, a change landing while rows still move adds
 * onto what they play rather than stopping it, a row arriving while the
 * lists are still read only fades in, nothing plays where no motion is
 * to play, and a row out of the reader's sight plays nothing, so a change
 * of thousands of rows plays a screenful.
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

/** A motion played: the element, its keyframes and timing, a way to have it finish, and whether it was stopped. */
interface Played {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly timing: KeyframeAnimationOptions;
  readonly finish: () => void;
  readonly stopped: () => boolean;
}

let root: Root | undefined;
let played: Played[] = [];

beforeEach(() => {
  played = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
      let cancelled = false;
      const motion = {
        onfinish: null as (() => void) | null,
        cancel: () => {
          cancelled = true;
        },
      };
      played.push({
        element: this,
        keyframes,
        timing,
        finish: () => motion.onfinish?.(),
        stopped: () => cancelled,
      });
      return motion;
    },
  });
  // Note that each list stands in its own column, and each row under the rows before it still in the layout.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const list = this.parentElement;
    // Note that a row taken out of the layout is drawn nowhere, as a browser draws it: an empty box at the window's corner.
    if (!this.matches("li") || list === null || this.style.display === "none") {
      return new DOMRect(0, 0, 0, 0);
    }
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

/** Lists side by side, each by its rows' keys, under one motion where `moving`, still being read where `reading`. */
function Lists({
  lists,
  moving,
  reading,
}: {
  lists: readonly (readonly string[])[];
  moving: boolean;
  reading: boolean;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const drawn = createElement(
    "div",
    { ref: box },
    lists.map((keys, at) => createElement(Rows, { key: String(at), keys })),
  );
  return moving ? createElement(ListMotion, { root: box, reading, children: drawn }) : drawn;
}

/** Draws `lists`, the motion's tokens set where `tokens`, and hands back a way to draw others, still being read where it says. */
function draw(
  lists: readonly (readonly string[])[],
  {
    moving = true,
    tokens = true,
    reading = false,
  }: { moving?: boolean; tokens?: boolean; reading?: boolean } = {},
): (next: readonly (readonly string[])[], stillReading?: boolean) => void {
  if (tokens) {
    for (const [name, value] of Object.entries(TOKENS)) {
      document.documentElement.style.setProperty(name, value);
    }
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Lists, { lists, moving, reading })));
  return (next, stillReading = false) =>
    act(() => root?.render(createElement(Lists, { lists: next, moving, reading: stillReading })));
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

test("a change landing while rows still move stops none of what they play, and adds the glide it asks for onto it", () => {
  const show = draw([["A", "B"]]);
  show([["A", "N", "B"]]);

  show([["A", "M", "N", "B"]]);

  expect(played.filter((each) => each.stopped())).toEqual([]);
  expect(motionsOf(rowOf("B")).at(-1)).toEqual([
    { transform: `translate(0px, ${-ROW}px)` },
    { transform: "none" },
  ]);
  const travels = played.filter((each) => "transform" in (each.keyframes[0] ?? {}));
  expect(travels.map((each) => each.timing.composite)).toEqual(travels.map(() => "add"));
});

test("while the lists are still read, rows arriving fade in where they stand, together, the change that ends the read included", () => {
  const show = draw([["A"]], { reading: true });

  show([["A", "B", "C"]], true);
  show([["A", "B", "C", "D"]], false);

  for (const key of ["B", "C", "D"]) {
    expect(motionsOf(rowOf(key))).toEqual([[{ opacity: 0 }, { opacity: 1 }]]);
  }
  const delays = ["B", "C"].map(
    (key) => played.find((each) => each.element === rowOf(key))?.timing.delay,
  );
  expect(delays).toEqual([0, 0]);
});

test("a row leaving slides out out of reach where it stood, and the rows under it glide up after it has gone first", () => {
  const show = draw([["A", "B", "C"]]);

  show([["A", "C"]]);

  const leaving = rowOf("B", true);
  expect(leaving?.hasAttribute("inert")).toBe(true);
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

test("a row arriving or leaving below the window's foot plays nothing, and one leaving there goes at once", () => {
  // Note that jsdom's window is 768px tall, so of these 40px rows the first stand in it and the last far below it.
  const many = Array.from({ length: 40 }, (_, at) => `R${at}`);
  const show = draw([["A"]]);

  show([["A", ...many]]);

  expect(motionsOf(rowOf("R0"))).toHaveLength(2);
  expect(motionsOf(rowOf("R39"))).toEqual([]);

  played = [];
  const far = rowOf("R39");
  show([["A"]]);

  expect(motionsOf(rowOf("R0", true))).toHaveLength(1);
  expect(motionsOf(far)).toEqual([]);
  expect(far?.isConnected).toBe(false);
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
