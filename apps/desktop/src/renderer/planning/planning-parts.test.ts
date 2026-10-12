// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MicrophoneIcon, MicrophoneOffIcon, SpeakerIcon, SpeakerOffIcon } from "@sidecar/panel";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import type { CallStatus } from "./planning-model";
import { CallBar } from "./planning-parts";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const IDLE_BACKEND = { planner: undefined, notes: false };

interface Call {
  status?: CallStatus;
  live?: boolean;
  label?: string;
  enabled?: boolean;
  muted?: boolean;
  speakerMuted?: boolean;
}

/** A bar mounted for a test, and every press it handed down. */
interface MountedBar {
  bar: HTMLElement;
  pressed: string[];
}

/** The bar as the tab draws it, and every press it handed down, in the order they landed. */
function callBar(call: Call = {}): MountedBar {
  const pressed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CallBar, {
        status: call.status,
        microphone: {
          label: call.label ?? "Talk about this plan",
          enabled: call.enabled ?? true,
          muted: call.muted ?? false,
          onPress: () => pressed.push("microphone"),
        },
        speaker: { muted: call.speakerMuted ?? false, onPress: () => pressed.push("speaker") },
        stop: { shown: call.live ?? false, onPress: () => pressed.push("stop") },
      }),
    ),
  );
  return { bar: container, pressed };
}

function button(bar: HTMLElement, name: string): HTMLButtonElement {
  const found = bar.querySelector(`button[aria-label="${name}"]`);
  assert.ok(found instanceof HTMLButtonElement, `no ${name} button`);
  return found;
}

function glyph(icon: () => React.JSX.Element): string {
  return renderToStaticMarkup(createElement(icon));
}

const LISTENING: Call = { live: true, status: { voiceWord: "Listening", backend: IDLE_BACKEND } };

test("at rest the bar is one start press named for what the microphone needs, which the microphone's press answers", () => {
  const { bar, pressed } = callBar();
  const buttons = bar.querySelectorAll("button");
  assert.equal(buttons.length, 1);
  const [start] = buttons;
  assert.ok(start);
  assert.equal(start.textContent, "Talk about this plan");
  assert.equal(start.disabled, false);
  act(() => start.click());
  assert.deepEqual(pressed, ["microphone"]);

  const keyless = callBar({ label: "Voice is off: sign in to turn it on.", enabled: false });
  const [off] = keyless.bar.querySelectorAll("button");
  assert.equal(off?.textContent, "Voice is off: sign in to turn it on.");
  assert.equal(off?.disabled, true);
});

test("in a call the microphone and speaker are mutes, pressed and struck through while on, apart from End call", () => {
  const live = callBar(LISTENING);
  assert.equal(live.bar.querySelector(".call-start"), null);
  const mute = button(live.bar, "Mute microphone");
  assert.equal(mute.getAttribute("aria-pressed"), "false");
  assert.equal(mute.innerHTML, glyph(MicrophoneIcon));
  const speaker = button(live.bar, "Mute speaker");
  assert.equal(speaker.getAttribute("aria-pressed"), "false");
  assert.equal(speaker.innerHTML, glyph(SpeakerIcon));

  const muted = callBar({ ...LISTENING, muted: true, speakerMuted: true });
  const unmute = button(muted.bar, "Unmute microphone");
  assert.equal(unmute.getAttribute("aria-pressed"), "true");
  assert.equal(unmute.innerHTML, glyph(MicrophoneOffIcon));
  const unsilence = button(muted.bar, "Unmute speaker");
  assert.equal(unsilence.getAttribute("aria-pressed"), "true");
  assert.equal(unsilence.innerHTML, glyph(SpeakerOffIcon));

  act(() => unmute.click());
  act(() => unsilence.click());
  act(() => button(muted.bar, "End call").click());
  assert.deepEqual(muted.pressed, ["microphone", "speaker", "stop"]);
});

test("a call reported with no stop, as a fixture stages one, is still drawn as the call", () => {
  const { bar } = callBar({
    live: false,
    status: { voiceWord: "Listening", backend: { planner: { action: undefined }, notes: false } },
  });
  assert.equal(bar.querySelector(".call-start"), null);
  assert.equal(bar.querySelector(".call-status-word")?.textContent, "Listening");
  assert.ok(bar.querySelector('button[aria-label="Mute microphone"]'));
});

test("the call's second line names the planning model's command and the notetaker, with the dots and a reader's status line", () => {
  const { bar } = callBar({
    live: true,
    status: {
      voiceWord: "Listening",
      backend: { planner: { action: "grep -rn invite src" }, notes: true },
    },
  });
  assert.equal(bar.querySelector(".call-status-word")?.textContent, "Listening");
  assert.ok(bar.querySelector('.thinking-dots[aria-hidden="true"]'));
  assert.deepEqual(
    [...bar.querySelectorAll(".call-backend-part")].map((part) => part.textContent),
    ["Planning model · grep -rn invite src", "Notetaker · Writing notes"],
  );
  assert.equal(bar.querySelector(".call-backend-action")?.textContent, "grep -rn invite src");
  assert.equal(bar.querySelector('[role="status"]')?.textContent, "Luke is working on it");
});

test("the planning model with no command pending reads Thinking, and an idle backend draws the voice's word alone", () => {
  const thinking = callBar({
    live: true,
    status: { voiceWord: "Handing off", backend: { planner: { action: undefined }, notes: false } },
  });
  assert.deepEqual(
    [...thinking.bar.querySelectorAll(".call-backend-part")].map((part) => part.textContent),
    ["Planning model · Thinking"],
  );

  const idle = callBar(LISTENING);
  assert.equal(idle.bar.querySelector(".call-status")?.textContent, "Listening");
  assert.equal(idle.bar.querySelector(".thinking-dots"), null);
  assert.equal(idle.bar.querySelector('[role="status"]'), null);
});
