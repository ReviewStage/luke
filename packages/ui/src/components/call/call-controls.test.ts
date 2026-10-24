// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import { MicrophoneOffIcon } from "../../face/glyphs.js";
import {
  CALL_CONTROL_LABEL,
  CALL_DEVICE,
  CALL_LIVE_WORD,
  CALL_STAGE,
  CallBar,
  CallLive,
  CallMute,
  VideoToggle,
} from "./call-controls.js";

/**
 * call-controls.test.ts -- a call's controls as a reader meets them: a mute
 * is named for what its press will do, says so as it toggles, announces
 * itself pressed while on, and carries its chord; End call is the bar's one
 * control that is no toggle and hands its press back; Video on or off
 * asks for the other; and a box's call status says the call is live, or
 * muted, and how long it has run, or that it is connecting or ending, with
 * no count. Synthetic call.
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

test("a mute toggles with its label: named for its next press, pressed while muted, with its chord", () => {
  const scope = draw(createElement(OwnedMute));
  const live = button(scope, CALL_CONTROL_LABEL.MUTE_MICROPHONE);
  expect(live.getAttribute("aria-pressed")).toBe("false");
  expect(live.getAttribute("aria-keyshortcuts")).toMatch(/Shift\+M/u);

  act(() => live.click());
  const muted = button(scope, CALL_CONTROL_LABEL.UNMUTE_MICROPHONE);
  expect(muted.getAttribute("aria-pressed")).toBe("true");
  expect(scope.querySelector(`[aria-label="${CALL_CONTROL_LABEL.MUTE_MICROPHONE}"]`)).toBeNull();

  act(() => muted.click());
  expect(button(scope, CALL_CONTROL_LABEL.MUTE_MICROPHONE).getAttribute("aria-pressed")).toBe(
    "false",
  );
});

test("the speaker's mute is its own, named for the speaker and toggled by its own chord", () => {
  const scope = draw(
    createElement(CallMute, { device: CALL_DEVICE.SPEAKER, muted: true, onPress: () => {} }),
  );
  const speaker = button(scope, CALL_CONTROL_LABEL.UNMUTE_SPEAKER);
  expect(speaker.getAttribute("aria-pressed")).toBe("true");
  expect(speaker.getAttribute("aria-keyshortcuts")).toMatch(/Shift\+S/u);
});

test("the bar's mutes and End call each hand their press back, and End call alone is no toggle", () => {
  const pressed: string[] = [];
  const scope = draw(
    createElement(CallBar, {
      status: { voiceWord: "Listening", backend: { brain: undefined, notes: false } },
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

test("the bar says what Luke is doing while the backend works, and that it works to a reader", () => {
  const scope = draw(
    createElement(CallBar, {
      status: { voiceWord: "Listening", backend: { brain: { action: "Reading" }, notes: true } },
      microphone: { muted: false, onPress: () => {} },
      speaker: { muted: false, onPress: () => {} },
      onEnd: () => {},
    }),
  );
  expect(scope.textContent).toContain("Reading");
  expect(scope.textContent).toContain("Writing notes");
  expect(scope.querySelector('[role="status"]')?.textContent).toBe("Luke is working on it");
});

test("Video on or off asks for the other, named for what its press will do", () => {
  const asked: boolean[] = [];
  const on = draw(createElement(VideoToggle, { on: true, onSetVideo: (to) => asked.push(to) }));
  act(() => button(on, CALL_CONTROL_LABEL.VIDEO_OFF).click());
  const off = draw(createElement(VideoToggle, { on: false, onSetVideo: (to) => asked.push(to) }));
  act(() => button(off, CALL_CONTROL_LABEL.VIDEO_ON).click());
  expect(asked).toEqual([false, true]);
});

test("a box's call status says the call is live and how long it has run, and says Muted, quietly, with the struck microphone while the microphone is muted", () => {
  const startedAt = Date.UTC(2026, 9, 24, 15, 0, 0);
  const now = startedAt + 72_000;
  const live = draw(
    createElement(CallLive, { stage: CALL_STAGE.LIVE, startedAt, muted: false, now }),
  );
  expect(live.textContent).toBe(`${CALL_LIVE_WORD.LIVE}1m 12s`);
  const timer = live.querySelector('[role="timer"]');
  expect(timer?.getAttribute("dateTime")).toBe("PT72S");

  const muted = draw(
    createElement(CallLive, { stage: CALL_STAGE.LIVE, startedAt, muted: true, now }),
  );
  expect(muted.textContent).toBe(`${CALL_LIVE_WORD.MUTED}1m 12s`);
  expect(muted.textContent).not.toContain(CALL_LIVE_WORD.LIVE);
  expect(muted.querySelector("svg")?.outerHTML).toBe(
    renderToStaticMarkup(createElement(MicrophoneOffIcon)),
  );
  expect(muted.querySelector('[data-tone="danger"]')).toBeNull();
});

test("a box's call status says Connecting… and Ending… either side of the call, quietly and with no count", () => {
  for (const [stage, word] of [
    [CALL_STAGE.CONNECTING, CALL_LIVE_WORD.CONNECTING],
    [CALL_STAGE.ENDING, CALL_LIVE_WORD.ENDING],
  ] as const) {
    const scope = draw(createElement(CallLive, { stage }));
    expect(scope.textContent).toBe(word);
    expect(scope.querySelector('[role="timer"]')).toBeNull();
    expect(scope.querySelector('[data-tone="complete"]')).toBeNull();
  }
});
