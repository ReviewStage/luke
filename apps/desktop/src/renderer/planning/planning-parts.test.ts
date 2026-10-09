import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import type { CallStatus } from "./planning-model";
import { MicrophoneRow } from "./planning-parts";

const ignore = () => undefined;

function microphoneRowMarkup(
  status: CallStatus,
  call: { muted: boolean; stop: boolean } = { muted: false, stop: false },
): string {
  return renderToStaticMarkup(
    createElement(MicrophoneRow, {
      status,
      microphone: {
        label: call.muted ? "Unmute the microphone" : "Mute the microphone",
        enabled: true,
        muted: call.muted,
        onPress: ignore,
      },
      stop: { shown: call.stop, onPress: ignore },
    }),
  );
}

const IDLE_BACKEND = { planner: undefined, notes: false };

test("a muted call presses the microphone and offers a stop apart from it, and no call offers no stop", () => {
  const muted = microphoneRowMarkup(
    { voiceWord: "Muted", backend: IDLE_BACKEND },
    { muted: true, stop: true },
  );
  assert.match(muted, /aria-label="Unmute the microphone"[^>]*aria-pressed="true"/u);
  assert.match(muted, /<button[^>]*class="plan-stop"[^>]*aria-label="End the call"/u);

  const heard = microphoneRowMarkup({ voiceWord: "Listening", backend: IDLE_BACKEND });
  assert.match(heard, /aria-pressed="false"/u);
  assert.doesNotMatch(heard, /plan-stop/u);
});

test("the microphone row's second line names the planning model's command and the notetaker, with the dots and a reader's status line", () => {
  const markup = microphoneRowMarkup({
    voiceWord: "Listening",
    backend: { planner: { action: "grep -rn invite src" }, notes: true },
  });
  assert.match(markup, /class="plan-voice-word">Listening</u);
  assert.match(markup, /class="thinking-dots" aria-hidden="true"/u);
  assert.match(
    markup,
    /Planning model · <span class="plan-backend-action">grep -rn invite src<\/span>/u,
  );
  assert.match(markup, />Notetaker · Writing notes</u);
  assert.match(markup, /role="status">Luke is working on it</u);
});

test("the planning model with no command pending reads Thinking", () => {
  const markup = microphoneRowMarkup({
    voiceWord: "Handing off",
    backend: { planner: { action: undefined }, notes: false },
  });
  assert.match(markup, />Planning model · Thinking</u);
  assert.doesNotMatch(markup, /Notetaker/u);
});

test("an idle backend draws the voice's word alone, with no dots and no status line", () => {
  const markup = microphoneRowMarkup({
    voiceWord: "Listening",
    backend: { planner: undefined, notes: false },
  });
  assert.match(markup, /class="plan-voice-word">Listening</u);
  assert.doesNotMatch(markup, /thinking-dots/u);
  assert.doesNotMatch(markup, /role="status"/u);
});
