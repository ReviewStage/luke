// @vitest-environment jsdom

import { MOTION_DELAY_MS } from "@luke/brand";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MARK_PROVIDER } from "../../marks/provider-mark.js";
import { FoldingButton } from "../folding-button/folding-button.js";
import { PROVIDER_BUTTON_SIZE, ProviderButton } from "../provider-button/provider-button.js";
import { SplitButton } from "../split-button/split-button.js";
import { BUTTON_VARIANT, type BusyProps, Button, IconButton } from "./button.js";

/**
 * busy.test.ts -- every kind of button is busy one way: given `busy` and the
 * `busyLabel` a reader hears, a Button, an IconButton, a SplitButton's main
 * part, a FoldingButton, and a ProviderButton in either size are named by
 * that label, say they are busy, and refuse their press at once, yet show
 * no ring until the press has been out the settle delay, and show it after.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** jsdom's stand-in for the browser's ResizeObserver, which a FoldingButton measures its fold by. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The busy shape every kind takes, saying it is saving. */
const SAVING: BusyProps = { busy: true, busyLabel: "Saving" };

/** Each kind of button, busy in the one shape, counting its presses into `presses`. */
function kinds(presses: string[]): ReadonlyArray<readonly [string, ReactElement]> {
  const press = (kind: string) => () => presses.push(kind);
  return [
    ["Button", createElement(Button, { ...SAVING, onClick: press("Button"), children: "Save" })],
    [
      "IconButton",
      createElement(IconButton, {
        ...SAVING,
        icon: createElement("svg"),
        label: "Save",
        onClick: press("IconButton"),
      }),
    ],
    [
      "SplitButton",
      createElement(SplitButton, {
        ...SAVING,
        onClick: press("SplitButton"),
        menu: {
          label: "More ways to save",
          "aria-haspopup": "menu",
          "aria-expanded": false,
          onClick: () => undefined,
        },
        children: "Save",
      }),
    ],
    [
      "FoldingButton",
      createElement(FoldingButton, {
        ...SAVING,
        label: "Save",
        icon: createElement("svg"),
        variant: BUTTON_VARIANT.OUTLINE,
        onClick: press("FoldingButton"),
      }),
    ],
    ...Object.values(PROVIDER_BUTTON_SIZE).map(
      (size) =>
        [
          `ProviderButton ${size}`,
          createElement(ProviderButton, {
            ...SAVING,
            provider: MARK_PROVIDER.GITHUB,
            name: "GitHub",
            size,
            onPress: press(`ProviderButton ${size}`),
          }),
        ] as const,
    ),
  ];
}

/** Draws `element` into a fresh container on the page. */
function mount(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The busy button a kind draws, the one a reader is told is busy. */
function busyButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-busy="true"]');
  if (button === null) throw new Error("no busy button is drawn");
  return button;
}

/** Whether a turning ring stands in `button`. */
function ringIn(button: HTMLElement): boolean {
  return button.querySelector(".luke-spinner-ring") !== null;
}

test("every kind of button takes the one busy shape: named by its label and refusing its press at once, its ring shown only once the settle delay has passed", () => {
  const presses: string[] = [];
  for (const [kind, element] of kinds(presses)) {
    const button = busyButton(mount(element));
    act(() => button.click());
    const name = button.getAttribute("aria-label") ?? button.textContent;
    expect({ kind, name, ring: ringIn(button) }).toEqual({
      kind,
      name: "Saving",
      ring: false,
    });
    act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE - 1));
    expect({ kind, ring: ringIn(button) }).toEqual({ kind, ring: false });
    act(() => vi.advanceTimersByTime(1));
    expect({ kind, ring: ringIn(button) }).toEqual({ kind, ring: true });
  }
  expect(presses).toEqual([]);
});

test("a press that lands before the settle delay never shows a ring, and its words stand throughout", () => {
  const draw = (busy: boolean) =>
    createElement(Button, { busy, busyLabel: "Saving", children: "Save" });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(draw(true)));
  const button = container.querySelector("button") ?? expect.unreachable("no button");
  const face = button.querySelector(".luke-button-face") ?? expect.unreachable("no face");
  expect(face.classList.contains("invisible")).toBe(false);
  act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE / 2));
  act(() => root.render(draw(false)));
  act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE));
  expect({ ring: ringIn(button), hidden: face.classList.contains("invisible") }).toEqual({
    ring: false,
    hidden: false,
  });
});

test("a busy button's words hide under the ring once it shows", () => {
  const button = busyButton(mount(createElement(Button, { ...SAVING, children: "Save" })));
  act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE));
  const face = button.querySelector(".luke-button-face") ?? expect.unreachable("no face");
  expect({ ring: ringIn(button), hidden: face.classList.contains("invisible") }).toEqual({
    ring: true,
    hidden: true,
  });
});
