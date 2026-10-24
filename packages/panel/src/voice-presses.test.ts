// @vitest-environment jsdom

/**
 * voice-presses.test.ts -- every press a person makes on a call goes out the
 * press door, so one main refuses says why in a toast: the call card's, the
 * agent box's, the video's, the voice's own, and a voice failure's remedy.
 * Synthetic call.
 */

import assert from "node:assert/strict";
import { VOICE_FAILURE } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { LIVE_STATUS } from "@luke/live";
import { CALL_CONTROL_LABEL } from "@luke/ui";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_OFF, AVATAR_STATUS } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { pressAct } from "./act.js";
import { CALL_CARD_SURFACE, CallCard, callControls, cardVideo } from "./call/call-card.js";
import { useAgentCallVideo } from "./call/panel-avatar.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { AgentCallControls } from "./tasks/agent-call.js";
import { type FakeActPort, fakeActPort, refusedOnPort } from "./testing/app-bridge.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";
import { useVoiceView } from "./use-voice-view.js";
import { WindowVoice } from "./window-voice.js";

const AGENT_ID = "agent-1";

/** A call standing into the agent, listening. */
const ON_CALL: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  call: { taskId: "task-1", agentId: AGENT_ID },
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** What the newest toast standing says, the one the last press raised. */
function newestToast(): string | undefined {
  return (
    [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].at(-1)
      ?.textContent ?? undefined
  );
}

/** A procedure main refuses in `sentence`. */
function refusing(sentence: string): () => Promise<never> {
  return () => Promise.reject(refusedOnPort(sentence));
}

/** A voice command main refuses in a sentence naming it, so each press's toast is told from the last. */
function refusingCommand({ command }: { readonly command: string }): Promise<never> {
  return Promise.reject(refusedOnPort(`The voice window refused ${command}.`));
}

/**
 * Draws `surface` over main's document holding `voice`, main answering the
 * procedures given, beside the window's toasts. Note that the toasts are drawn
 * on both registries the test holds apart, the surface's own, where a notice
 * it raises stands, and the window's, where a press's toast is raised, because
 * in the window they are one.
 */
async function drawOver(
  surface: ReactElement,
  procedures: Partial<FakeActPort>,
  voice: VoiceView = ON_CALL,
  patch: Partial<AppStateSnapshot> = {},
): Promise<void> {
  handState({}, { voice: { avatar: AVATAR_OFF, view: voice }, ...patch });
  fakeActPort(procedures);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        onRegistry(
          AtomRegistry.make(),
          createElement(Fragment, null, surface, createElement(ToastHost)),
        ),
        onRegistry(rendererRegistry, createElement(ToastHost)),
      ),
    ),
  );
}

/** The button a reader knows by `label`. */
function button(label: string): HTMLButtonElement {
  return (
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    [...document.querySelectorAll("button")].find((each) => each.textContent === label) ??
    assert.fail(`no ${label} button`)
  );
}

/** Presses `label` and lets main's answer, and the toast it raises, land. */
async function press(label: string): Promise<void> {
  await act(async () => button(label).click());
}

test("the call card's End call and way back main refuses say why in a toast", async () => {
  await drawOver(
    createElement(CallCard, {
      card: { taskName: "Invite expiry", status: undefined, microphoneMuted: false },
      speakerMuted: false,
      controls: callControls(pressAct, false),
      surface: CALL_CARD_SURFACE.SIDEBAR,
    }),
    {
      [ACT_KIND.VOICE_COMMAND]: refusingCommand,
      [ACT_KIND.CALL_SHOW_AGENT]: refusing("The call's task is gone."),
    },
  );

  await press(CALL_CONTROL_LABEL.END_CALL);
  assert.equal(newestToast(), "The voice window refused end-call.");
  await press("Open Invite expiry");
  assert.equal(newestToast(), "The call's task is gone.");
});

test("the call card's Video off main refuses says why in a toast", async () => {
  await drawOver(createElement(Fragment), {
    [ACT_KIND.VOICE_SET_VIDEO]: refusing("The card's video is not offered on this call."),
  });
  const video = cardVideo(AVATAR_STATUS.LIVE, undefined, pressAct) ?? assert.fail("video offered");

  await act(async () => video.onSetVideo(false));

  assert.equal(newestToast(), "The card's video is not offered on this call.");
});

test("the agent box's speaker and End call main refuses say why in a toast", async () => {
  await drawOver(
    createElement(AgentCallControls, {
      agentId: AGENT_ID,
      doors: { onPress: () => undefined },
      startedAt: undefined,
    }),
    { [ACT_KIND.VOICE_COMMAND]: refusingCommand },
  );

  await press(CALL_CONTROL_LABEL.MUTE_SPEAKER);
  assert.equal(newestToast(), "The voice window refused mute-speaker.");
  await press(CALL_CONTROL_LABEL.END_CALL);
  assert.equal(newestToast(), "The voice window refused end-call.");
});

test("an agent's Video off main refuses says why in a toast", async () => {
  let video: ReturnType<typeof useAgentCallVideo> | undefined;
  function Probe(): null {
    video = useAgentCallVideo(AGENT_ID);
    return null;
  }
  await drawOver(createElement(Probe), {
    [ACT_KIND.VOICE_SET_VIDEO]: refusing("The agent's video is not offered on this call."),
  });

  await act(async () => video?.onSetVideo(false));

  assert.equal(newestToast(), "The agent's video is not offered on this call.");
});

test("the voice's Stop speaking and microphone ask main refuses say why in a toast", async () => {
  let voice: ReturnType<typeof useVoiceView> | undefined;
  function Probe(): null {
    voice = useVoiceView();
    return null;
  }
  await drawOver(createElement(Probe), { [ACT_KIND.VOICE_COMMAND]: refusingCommand });

  await act(async () => voice?.stopSpeaking());
  assert.equal(newestToast(), "The voice window refused stop-speaking.");
  await act(async () => voice?.requestMicrophoneAccess());
  assert.equal(newestToast(), "The voice window refused request-microphone-access.");
});

test("a refused microphone's Open System Settings main refuses says why in a toast", async () => {
  await drawOver(
    createElement(WindowVoice, { available: true, agentShown: undefined, children: null }),
    { [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: refusing("System Settings could not be opened.") },
    { ...IDLE_VOICE_VIEW, voiceError: VOICE_FAILURE.MICROPHONE_REFUSED },
  );

  await press("Open System Settings");

  assert.equal(newestToast(), "System Settings could not be opened.");
});

/** The microphone's mute, which the keymap answers only once macOS grants the microphone. */
function microphoneMute(): HTMLButtonElement {
  return button(CALL_CONTROL_LABEL.MUTE_MICROPHONE);
}

const MICROPHONE_SURFACES = {
  "the agent box": createElement(AgentCallControls, {
    agentId: AGENT_ID,
    doors: { onPress: () => undefined },
    startedAt: undefined,
  }),
  "the call card": createElement(CallCard, {
    card: { taskName: "Invite expiry", status: undefined, microphoneMuted: false },
    speakerMuted: false,
    controls: callControls(pressAct, false),
    surface: CALL_CARD_SURFACE.SIDEBAR,
  }),
};

for (const [name, surface] of Object.entries(MICROPHONE_SURFACES)) {
  test(`${name}'s microphone mute names no chord until the microphone is granted, then ⇧⌘M`, async () => {
    await drawOver(surface, {}, ON_CALL, {
      audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED },
    });
    assert.equal(microphoneMute().getAttribute("aria-keyshortcuts"), null);
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
      document.body.innerHTML = "";
    });

    await drawOver(surface, {}, ON_CALL, {
      audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    });
    assert.match(microphoneMute().getAttribute("aria-keyshortcuts") ?? "", /Shift\+M/u);
  });
}
