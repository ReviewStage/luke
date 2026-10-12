// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_STATUS } from "@sidecar/live";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  type VoiceCommand,
  type VoiceView,
} from "#shared/messages/voice-view";
import { APP_COMMAND, APP_SHORTCUTS } from "#shared/shortcuts";
import { useAppKeymap } from "./app-commands";
import { useCallCommands } from "./call-commands";

const BILLING_PLAN = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

let root: Root | undefined;
/** Every command the chords handed to the voice window, in order. */
let sent: VoiceCommand[] = [];

function Panel({ view, granted }: { view: VoiceView; granted: boolean }): null {
  useAppKeymap(true);
  useCallCommands(view, granted, (command) => sent.push(command));
  return null;
}

function draw(view: VoiceView, granted = true): void {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Panel, { view, granted }));
  });
}

/** Presses a command's own chord, answering whether the panel claimed it. */
function press(command: typeof APP_COMMAND.TOGGLE_MICROPHONE | typeof APP_COMMAND.TOGGLE_SPEAKER) {
  const { chord } = APP_SHORTCUTS[command];
  const event = new KeyboardEvent("keydown", {
    key: chord.key.key,
    code: chord.key.code,
    metaKey: true,
    shiftKey: chord.shift === true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  sent = [];
  document.body.innerHTML = "";
});

test("the mute chords reach the standing call with no call bar on screen, naming no plan, and only while it is in progress", () => {
  draw(IDLE_VOICE_VIEW);
  assert.equal(press(APP_COMMAND.TOGGLE_MICROPHONE), false);
  assert.equal(press(APP_COMMAND.TOGGLE_SPEAKER), false);

  const call: VoiceView = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: LIVE_STATUS.LISTENING,
    listening: true,
    callPlanId: BILLING_PLAN,
  };
  draw(call);
  assert.equal(press(APP_COMMAND.TOGGLE_MICROPHONE), true);
  assert.equal(press(APP_COMMAND.TOGGLE_SPEAKER), true);
  draw({ ...call, speakerMuted: true });
  assert.equal(press(APP_COMMAND.TOGGLE_SPEAKER), true);
  assert.deepEqual(sent, [
    VOICE_COMMAND.TOGGLE_MICROPHONE,
    VOICE_COMMAND.MUTE_SPEAKER,
    VOICE_COMMAND.UNMUTE_SPEAKER,
  ]);

  // A call closing is no longer one to mute.
  draw({ ...call, voiceStatus: LIVE_STATUS.CLOSING });
  assert.equal(press(APP_COMMAND.TOGGLE_MICROPHONE), false);
  assert.equal(sent.length, 3);
});

test("a microphone the system refused mid-call is not toggled by its chord, and Luke's voice still is", () => {
  draw(
    {
      ...IDLE_VOICE_VIEW,
      voiceStatus: LIVE_STATUS.MUTED,
      callPlanId: BILLING_PLAN,
    },
    false,
  );
  assert.equal(press(APP_COMMAND.TOGGLE_MICROPHONE), false);
  assert.equal(press(APP_COMMAND.TOGGLE_SPEAKER), true);
  assert.deepEqual(sent, [VOICE_COMMAND.MUTE_SPEAKER]);
});
