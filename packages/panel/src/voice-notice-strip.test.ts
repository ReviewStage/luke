// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { VoiceSpeakers } from "@luke/voice/voice-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useVoiceNotice } from "./use-voice-notice.js";
import { VoiceNoticeStrip } from "./voice-notice-strip.js";

/**
 * voice-notice-strip.test.ts -- the voice's notice line draws what the voice
 * has to say about itself, a failure, a notice, or that the Mac's output is
 * off, and never a word anyone said, which streams into the agent's
 * transcript instead. Synthetic throughout.
 */

const LUKE_SPEAKING: VoiceSpeakers = { listening: false, lukeSpeaking: true };
const DEVELOPER_SPEAKING: VoiceSpeakers = { listening: true, lukeSpeaking: false };
const NOBODY: VoiceSpeakers = { listening: false, lukeSpeaking: false };

const HINT = "Your Mac's sound is off.";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

interface Staged {
  speakers: VoiceSpeakers;
  error?: string;
  notice?: string;
  silent?: boolean;
  onDismissHint?: () => void;
}

/** The line as the window draws it over the voice staged. */
function Line({ staged }: { staged: Staged }): React.JSX.Element {
  const notice = useVoiceNotice({
    voiceError: staged.error,
    voiceNotice: staged.notice,
    speakers: staged.speakers,
    fixtureSpeaking: false,
    volumeHint: { wanted: staged.silent === true, text: HINT },
  });
  return createElement(VoiceNoticeStrip, {
    notice,
    onDismissHint: staged.onDismissHint ?? (() => undefined),
  });
}

function drawn(staged: Staged): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Line, { staged })));
  const line = container.querySelector<HTMLElement>(".voice-notice");
  assert.ok(line, "the line is one element in every state");
  return line;
}

/** The line drawn again over the voice staged anew, as the window draws it when the voice moves. */
function redrawn(staged: Staged): void {
  const root = roots.at(-1);
  assert.ok(root);
  act(() => root.render(createElement(Line, { staged })));
}

test("while either speaker is heard and the voice has nothing to say about itself, the line stands empty and hidden: no captions", () => {
  for (const speakers of [LUKE_SPEAKING, DEVELOPER_SPEAKING]) {
    const line = drawn({ speakers });
    assert.equal(line.dataset.shown, "false");
    assert.equal(line.textContent, "");
  }
});

test("a failure shows on the line in its tone, announced, once nobody is heard over it", () => {
  const line = drawn({ speakers: NOBODY, error: "The call dropped." });
  assert.equal(line.dataset.shown, "true");
  assert.equal(line.dataset.tone, "error");
  assert.equal(line.querySelector('[role="status"]')?.textContent, "The call dropped.");
});

test("while Luke speaks into a Mac whose output is off, the line says so with a Got it that quiets it", () => {
  const dismissed: string[] = [];
  const line = drawn({
    speakers: LUKE_SPEAKING,
    silent: true,
    onDismissHint: () => dismissed.push("got it"),
  });
  assert.equal(line.dataset.shown, "true");
  assert.equal(line.dataset.tone, "volume");
  assert.match(line.textContent ?? "", /Your Mac's sound is off\.Got it$/u);
  const button = line.querySelector("button");
  assert.ok(button);
  act(() => button.click());
  assert.deepEqual(dismissed, ["got it"]);
});

test("the volume hint leaves at once when it is answered, by Got it or by the output being heard again, while a failure lingers to be read", () => {
  const hint = drawn({ speakers: LUKE_SPEAKING, silent: true });
  assert.equal(hint.dataset.shown, "true");
  redrawn({ speakers: LUKE_SPEAKING, silent: false });
  assert.equal(hint.dataset.shown, "false", "no stale hint or Got it after it was answered");
  assert.equal(hint.hasAttribute("inert"), true, "and its button takes no press");

  const failure = drawn({ speakers: NOBODY, error: "The call dropped." });
  redrawn({ speakers: NOBODY });
  assert.equal(failure.dataset.shown, "true", "a failure stays a moment so it is read");
});
