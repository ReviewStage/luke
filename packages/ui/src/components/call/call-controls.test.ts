// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CALL_CONTROL_LABEL, CALL_DEVICE, CallBar, CallMute } from "./call-controls.js";

/**
 * call-controls.test.ts -- a call's controls as a reader meets them: a mute
 * is named for what its press will do, says so as it toggles, and announces
 * itself pressed while on; End call is the bar's one control that is no
 * toggle and hands its press back. Synthetic call.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function draw(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The button `scope` holds named `name`. */
function button(scope: HTMLElement, name: string): HTMLButtonElement {
  const found = scope.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (found === null) throw new Error(`No ${name}`);
  return found;
}

/** A microphone mute whose owner keeps whether it is muted, as the call's owner does. */
function OwnedMute(): React.JSX.Element {
  const [muted, setMuted] = useState(false);
  return createElement(CallMute, {
    device: CALL_DEVICE.MICROPHONE,
    muted,
    onPress: () => setMuted((was) => !was),
  });
}

test("a mute toggles with its label: named for its next press, and pressed while muted", () => {
  const scope = draw(createElement(OwnedMute));
  const live = button(scope, CALL_CONTROL_LABEL.MUTE_MICROPHONE);
  expect(live.getAttribute("aria-pressed")).toBe("false");

  act(() => live.click());
  const muted = button(scope, CALL_CONTROL_LABEL.UNMUTE_MICROPHONE);
  expect(muted.getAttribute("aria-pressed")).toBe("true");
  expect(scope.querySelector(`[aria-label="${CALL_CONTROL_LABEL.MUTE_MICROPHONE}"]`)).toBeNull();

  act(() => muted.click());
  expect(button(scope, CALL_CONTROL_LABEL.MUTE_MICROPHONE).getAttribute("aria-pressed")).toBe(
    "false",
  );
});

test("the bar's mutes and End call each hand their press back, and End call alone is no toggle", () => {
  const pressed: string[] = [];
  const scope = draw(
    createElement(CallBar, {
      status: { voiceWord: "Listening", backend: { agent: undefined } },
      microphone: { muted: false, onPress: () => pressed.push("microphone") },
      speaker: { muted: false, onPress: () => pressed.push("speaker") },
      onEnd: () => pressed.push("end"),
    }),
  );
  expect(scope.textContent).toContain("Listening");
  act(() => button(scope, CALL_CONTROL_LABEL.MUTE_SPEAKER).click());
  act(() => button(scope, CALL_CONTROL_LABEL.MUTE_MICROPHONE).click());
  act(() => button(scope, CALL_CONTROL_LABEL.END_CALL).click());
  expect(pressed).toEqual(["speaker", "microphone", "end"]);
  const toggles = [...scope.querySelectorAll("button")].filter((each) =>
    each.hasAttribute("aria-pressed"),
  );
  expect(toggles.map((each) => each.getAttribute("aria-label"))).toEqual([
    CALL_CONTROL_LABEL.MUTE_SPEAKER,
    CALL_CONTROL_LABEL.MUTE_MICROPHONE,
  ]);
});

test("the bar says what Luke is doing while the backend works, with no subject and no notetaker, and that it works to a reader", () => {
  const scope = draw(
    createElement(CallBar, {
      status: { voiceWord: "Listening", backend: { agent: { action: "Reading" } } },
      microphone: { muted: false, onPress: () => {} },
      speaker: { muted: false, onPress: () => {} },
      onEnd: () => {},
    }),
  );
  expect(scope.textContent).toContain("Working · Reading");
  expect(scope.textContent).not.toMatch(/Luke ·|Notetaker|Writing notes/u);
  expect(scope.querySelector('[role="status"]')?.textContent).toBe("Luke is working on it");
});
