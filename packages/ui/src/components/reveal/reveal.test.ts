// @vitest-environment jsdom

import { act, createElement, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ListMotion } from "../list-motion/list-motion.js";
import { SettingsSection } from "../settings-section/settings-section.js";
import { Reveal, RevealArea, RevealChoice, revealArea } from "./reveal.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROW = 40;

const TOKENS = {
  "--ui-duration-exit": "90ms",
  "--ui-motion-exit": "ease",
  "--ui-duration-quick": "140ms",
  "--ui-duration-shape": "460ms",
  "--ui-spring": "ease-out",
  "--ui-row-stagger": "32ms",
} as const;

const ROLLED_UP = { clipPath: "inset(0 0 100% 0)" };
const UNROLLED = { clipPath: "inset(0)" };

interface Played {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly timing: KeyframeAnimationOptions;
  readonly finish: () => void;
}

let root: Root | undefined;
let played: Played[] = [];

function laidOut(element: Element): boolean {
  return element instanceof HTMLElement && element.style.position !== "absolute";
}

function heightOf(element: Element): number {
  if (element.matches("p")) return ROW;
  return [...element.children].filter(laidOut).reduce((sum, child) => sum + heightOf(child), 0);
}

function topOf(element: Element): number {
  const parent = element.parentElement;
  if (parent === null || element.matches(".ui-settings-section-card")) return 0;
  if (element instanceof HTMLElement && element.style.position === "absolute") {
    return topOf(parent) + Number.parseFloat(element.style.top);
  }
  const before = [...parent.children].slice(0, [...parent.children].indexOf(element));
  return topOf(parent) + before.filter(laidOut).reduce((sum, each) => sum + heightOf(each), 0);
}

beforeEach(() => {
  played = [];
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
      const motion = { onfinish: null as (() => void) | null, cancel: () => undefined };
      played.push({ element: this, keyframes, timing, finish: () => motion.onfinish?.() });
      return motion;
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, topOf(this), 200, heightOf(this));
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

function row(words: string): ReactNode {
  return createElement("p", { key: words }, words);
}

function draw<Props extends object>(
  card: (props: Props) => ReactNode,
  props: Props,
): (next: Props) => void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const Card = (each: Props) => card(each);
  act(() => root?.render(createElement(Card, props)));
  return (next) => act(() => root?.render(createElement(Card, next)));
}

function switchCard({ on }: { on: boolean }): ReactNode {
  return createElement(
    SettingsSection,
    null,
    row("Switch"),
    createElement(Reveal, { shown: on, children: [row("From"), row("Until")] }),
    row("Under"),
  );
}

function rowOf(words: string): Element | undefined {
  return [...document.querySelectorAll("p")].find((each) => each.textContent === words);
}

function boxOf(words: string): Element | null | undefined {
  return rowOf(words)?.closest(".ui-reveal");
}

function motionsOf(element: Element | null | undefined): Keyframe[][] {
  return played.filter((each) => each.element === element).map((each) => each.keyframes);
}

test("a setting turned on unrolls its rows in as they fade in, and the row under them glides down from where it stood", () => {
  const show = draw(switchCard, { on: false });
  expect(rowOf("From")).toBeUndefined();

  show({ on: true });

  expect(motionsOf(boxOf("From"))).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    [ROLLED_UP, UNROLLED],
  ]);
  expect(motionsOf(rowOf("Under"))).toEqual([
    [{ transform: `translate(0px, ${-2 * ROW}px)` }, { transform: "none" }],
  ]);
  const unroll = played.find((each) => "clipPath" in (each.keyframes[0] ?? {}));
  const glide = played.find((each) => each.element === rowOf("Under"));
  expect(unroll?.timing.duration).toBe(glide?.timing.duration);
});

test("a setting turned off holds its rows drawn as they roll up, the row under them closing over them at once, and lets them go once that has played", () => {
  const show = draw(switchCard, { on: true });

  show({ on: false });

  const box = boxOf("From");
  expect(box?.hasAttribute("inert")).toBe(true);
  expect(motionsOf(box)).toEqual([
    [
      { opacity: "1", ...UNROLLED },
      { opacity: 0, ...ROLLED_UP },
    ],
  ]);
  const close = played.find((each) => each.element === rowOf("Under"));
  expect(close?.keyframes[0]).toEqual({ transform: `translate(0px, ${2 * ROW}px)` });
  expect(close?.timing.delay).toBe(0);
  expect(close?.timing.duration).toBe(90);

  act(() => played.find((each) => each.element === box)?.finish());

  expect(rowOf("From")).toBeUndefined();
});

test("two reveals turned on in one change glide the row under them once, as far as both moved it", () => {
  const card = ({ on }: { on: boolean }) =>
    createElement(
      SettingsSection,
      null,
      row("Switch"),
      createElement(Reveal, { shown: on, children: row("First") }),
      row("Between"),
      createElement(Reveal, { shown: on, children: row("Second") }),
      row("Under"),
    );
  const show = draw(card, { on: false });

  show({ on: true });

  expect(motionsOf(rowOf("Under"))).toEqual([
    [{ transform: `translate(0px, ${-2 * ROW}px)` }, { transform: "none" }],
  ]);
  expect(motionsOf(rowOf("Between"))).toEqual([
    [{ transform: `translate(0px, ${-ROW}px)` }, { transform: "none" }],
  ]);
});

test("a choice picked again rolls up the rows of the value left as the rows of the one picked unroll on the spring, the row under them gliding with them", () => {
  const card = ({ kind }: { kind: "schedule" | "webhook" }) =>
    createElement(
      SettingsSection,
      null,
      row("Type"),
      createElement(RevealChoice<"schedule" | "webhook">, {
        value: kind,
        children: (value) =>
          value === "schedule" ? row("Repeats") : [row("Address"), row("Secret")],
      }),
      row("Under"),
    );
  const show = draw(card, { kind: "schedule" });

  show({ kind: "webhook" });

  expect(motionsOf(boxOf("Repeats"))).toEqual([
    [
      { opacity: "1", ...UNROLLED },
      { opacity: 0, ...ROLLED_UP },
    ],
  ]);
  expect(motionsOf(boxOf("Address"))).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    [ROLLED_UP, UNROLLED],
  ]);
  const unroll = played.find(
    (each) => each.element === boxOf("Address") && "clipPath" in (each.keyframes[0] ?? {}),
  );
  const glide = played.find((each) => each.element === rowOf("Under"));
  expect(glide?.keyframes[0]).toEqual({ transform: `translate(0px, ${-ROW}px)` });
  expect([unroll?.timing.duration, glide?.timing.duration]).toEqual([460, 460]);
});

test("outside a reveal area a setting's rows come and go at once", async () => {
  const bare = ({ on }: { on: boolean }) =>
    createElement("div", null, createElement(Reveal, { shown: on, children: row("From") }));
  const show = draw(bare, { on: false });

  show({ on: true });
  show({ on: false });
  await act(async () => undefined);

  expect(played).toEqual([]);
  expect(rowOf("From")).toBeUndefined();
});

test("an area that is its own takes its reveals even where an outer area stands, so the rows under a nested motion root glide with them", () => {
  const nested = ({ on }: { on: boolean }) => {
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const rows = createElement(
      "div",
      { ref: inner, ...revealArea() },
      row("Switch"),
      createElement(Reveal, { shown: on, children: row("From") }),
      row("Under"),
    );
    const motion = createElement(ListMotion, {
      root: inner,
      change: 0,
      children: createElement(RevealArea, { root: inner, own: true, children: rows }),
    });
    return createElement(RevealArea, {
      root: outer,
      children: createElement("div", { ref: outer, ...revealArea() }, motion),
    });
  };
  const show = draw(nested, { on: false });

  show({ on: true });

  expect(motionsOf(boxOf("From"))).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    [ROLLED_UP, UNROLLED],
  ]);
  expect(motionsOf(rowOf("Under"))).toHaveLength(1);
});
