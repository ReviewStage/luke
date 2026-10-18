// @vitest-environment jsdom

import assert from "node:assert/strict";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CALL_CONTROL_LABEL, CallBar } from "./tasks-parts";

/**
 * tasks-parts.test.ts -- the call bar's three states as a reader meets
 * them: at rest one start, refused while the microphone is unavailable; in
 * a call each mute announced pressed while it is on and named for what its
 * press does, and End call apart from both, each press reaching the caller.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

type CallBarProps = Parameters<typeof CallBar>[0];

/** Draws the bar and hands back its container. */
function draw(props: CallBarProps): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(CallBar, props))));
  return container;
}

/** The button `scope` holds, named `name` by its label or its words. */
function button(scope: HTMLElement, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  assert.ok(found, `${name} is offered`);
  return found;
}

/** A bar whose every press is written down by name. */
function bar(
  pressed: string[],
  state: { inCall: boolean; enabled?: boolean; micMuted?: boolean; speakerMuted?: boolean },
): CallBarProps {
  return {
    status: undefined,
    microphone: {
      label: "Talk about this task",
      enabled: state.enabled ?? true,
      muted: state.micMuted ?? false,
      onPress: () => pressed.push("microphone"),
    },
    speaker: { muted: state.speakerMuted ?? false, onPress: () => pressed.push("speaker") },
    stop: { shown: state.inCall, onPress: () => pressed.push("end") },
  };
}

test("at rest the bar is one start, which presses the microphone, and is refused while it is unavailable", () => {
  const pressed: string[] = [];
  const ready = draw(bar(pressed, { inCall: false }));
  assert.deepEqual(
    [...ready.querySelectorAll("button")].map((each) => each.textContent),
    ["Talk about this task"],
  );
  act(() => button(ready, "Talk about this task").click());
  assert.deepEqual(pressed, ["microphone"]);

  const unavailable = draw(bar(pressed, { inCall: false, enabled: false }));
  assert.equal(button(unavailable, "Talk about this task").disabled, true);
});

test("in a call each mute is announced pressed while it is on, and every control's press reaches the caller", () => {
  const pressed: string[] = [];
  const hearing = draw(bar(pressed, { inCall: true }));
  const speaker = button(hearing, CALL_CONTROL_LABEL.MUTE_SPEAKER);
  const microphone = button(hearing, CALL_CONTROL_LABEL.MUTE_MICROPHONE);
  assert.equal(speaker.getAttribute("aria-pressed"), "false");
  assert.equal(microphone.getAttribute("aria-pressed"), "false");
  act(() => speaker.click());
  act(() => microphone.click());
  act(() => button(hearing, CALL_CONTROL_LABEL.END_CALL).click());
  assert.deepEqual(pressed, ["speaker", "microphone", "end"]);
  assert.equal(button(hearing, CALL_CONTROL_LABEL.END_CALL).hasAttribute("aria-pressed"), false);

  const muted = draw(bar(pressed, { inCall: true, micMuted: true, speakerMuted: true }));
  assert.equal(
    button(muted, CALL_CONTROL_LABEL.UNMUTE_SPEAKER).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    button(muted, CALL_CONTROL_LABEL.UNMUTE_MICROPHONE).getAttribute("aria-pressed"),
    "true",
  );
});
