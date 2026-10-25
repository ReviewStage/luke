// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  VOICE_FAILURE,
  VOICE_REMEDY,
  type VoiceFailure,
  type VoiceRemedy,
} from "@luke/features/words";
import { SpeakerIcon } from "@luke/ui";
import type { VoiceSpeakers } from "@luke/voice/voice-view";
import { Duration } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "./testing/copy-feedback.js";
import { TOAST_HOLD, ToastHost } from "./toast.js";
import { useVoiceNotice } from "./use-voice-notice.js";
import { useVoiceNoticeToast } from "./voice-notice-toast.js";

/**
 * voice-notice-toast.test.ts -- what the voice has to say about itself, a
 * failure, a notice, or that the Mac's output is off, stands as a toast in
 * the window's one stack for as long as the voice says it, and never a word
 * anyone said, which streams into the agent's transcript instead. A failure
 * is said as an alert and offers its remedy; the volume hint offers Hide
 * and leaves at once once answered, while a failure lingers a toast's Done
 * hold to be read. Synthetic throughout.
 */

const LUKE_SPEAKING: VoiceSpeakers = { listening: false, lukeSpeaking: true };
const DEVELOPER_SPEAKING: VoiceSpeakers = { listening: true, lukeSpeaking: false };
const NOBODY: VoiceSpeakers = { listening: false, lukeSpeaking: false };

const HINT = "Your Mac's sound is off.";

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  registry?.dispose();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

interface Staged {
  speakers: VoiceSpeakers;
  error?: VoiceFailure;
  notice?: VoiceFailure;
  silent?: boolean;
  onDismissHint?: () => void;
  onRemedy?: (remedy: VoiceRemedy) => void;
}

/** The voice's notices as the window stands them over the voice staged. */
function Notices({ staged }: { staged: Staged }): null {
  const notice = useVoiceNotice({
    voiceError: staged.error,
    voiceNotice: staged.notice,
    speakers: staged.speakers,
    fixtureSpeaking: false,
    volumeHint: { wanted: staged.silent === true, text: HINT },
  });
  useVoiceNoticeToast({
    notice,
    onDismissHint: staged.onDismissHint ?? (() => undefined),
    onRemedy: staged.onRemedy ?? (() => undefined),
  });
  return null;
}

/** The window's toasts beside the voice staged, as its root mounts them. */
function scene(staged: Staged) {
  return createElement(
    Fragment,
    null,
    createElement(Notices, { staged }),
    createElement(ToastHost),
  );
}

/** Mounts the window over the voice staged. */
function drawn(staged: Staged): void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() => root?.render(onRegistry(held, scene(staged))));
}

/** The window drawn again over the voice staged anew, as it draws when the voice moves. */
function redrawn(staged: Staged): void {
  const held = registry ?? assert.fail("the window is mounted");
  act(() => root?.render(onRegistry(held, scene(staged))));
}

/** What each toast standing says, oldest first, leaving out those on their way out. */
function standing(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

/** The control a standing toast labels `label`, a button or a link, in its words or, for its ×, by its name. */
function toastControl(label: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>(".luke-toast:not([data-leaving]) :is(button, a)"),
  ].find(
    (control) => control.textContent === label || control.getAttribute("aria-label") === label,
  );
  return found ?? assert.fail(`a toast control named ${label}`);
}

/** What the stack's live region of `role` says now. */
function said(role: "alert" | "status"): string {
  return document.querySelector(`[role="${role}"]`)?.textContent ?? "";
}

/** Lets `ms` pass on the faked clock. */
function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

test("while either speaker is heard and the voice has nothing to say about itself, no toast stands: no captions", () => {
  for (const speakers of [LUKE_SPEAKING, DEVELOPER_SPEAKING]) {
    drawn({ speakers });
    assert.deepEqual(standing(), []);
    act(() => root?.unmount());
    document.body.innerHTML = "";
  }
});

test("a call that did not start stands as a toast in its own words, said as an alert, once nobody is heard over it", () => {
  drawn({ speakers: NOBODY, error: VOICE_FAILURE.CALL_NOT_STARTED });
  const words = "Luke could not start the call. Try again in a moment.";
  assert.deepEqual(standing(), [words]);
  assert.equal(said("alert"), words);
  assert.equal(said("status"), "");
});

test("a failure the voice still says stands past every toast hold, because the voice decides how long it stands", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  drawn({ speakers: NOBODY, error: VOICE_FAILURE.CALL_DROPPED });
  pass(Duration.toMillis(TOAST_HOLD.FAILED) * 2);
  assert.deepEqual(standing(), [
    "The call dropped: the connection was lost. Call again to carry on.",
  ]);
});

test("a call whose OpenAI key is missing, refused or out of credit offers the remedy that fixes it, and its press does it", () => {
  const cases = [
    {
      failure: VOICE_FAILURE.OPENAI_KEY_MISSING,
      label: "Add an OpenAI key",
      remedy: VOICE_REMEDY.ADD_OPENAI_KEY,
    },
    {
      failure: VOICE_FAILURE.OPENAI_KEY_REFUSED,
      label: "Add an OpenAI key",
      remedy: VOICE_REMEDY.ADD_OPENAI_KEY,
    },
    {
      failure: VOICE_FAILURE.OPENAI_KEY_UNFUNDED,
      label: "Add OpenAI credit",
      remedy: VOICE_REMEDY.ADD_OPENAI_CREDIT,
    },
  ] as const;
  for (const { failure, label, remedy } of cases) {
    const remedies: VoiceRemedy[] = [];
    drawn({ speakers: NOBODY, error: failure, onRemedy: (pressed) => remedies.push(pressed) });
    const control = toastControl(label);
    if (failure === VOICE_FAILURE.OPENAI_KEY_UNFUNDED) {
      assert.equal(control.tagName, "A", "a remedy that opens a page is a link");
      assert.equal(
        control.getAttribute("href"),
        "https://platform.openai.com/settings/organization/billing/overview",
      );
    } else {
      assert.equal(control.tagName, "BUTTON");
    }
    act(() => control.click());
    assert.deepEqual(remedies, [remedy]);
    assert.deepEqual(standing(), [], "the press sends the toast away");
    act(() => root?.unmount());
    registry?.dispose();
    document.body.innerHTML = "";
  }
});

test("a failure dismissed while the voice still says it stays dismissed, and the next thing the voice says stands anew", () => {
  drawn({ speakers: NOBODY, error: VOICE_FAILURE.OPENAI_KEY_MISSING });
  act(() => toastControl("Dismiss").click());
  redrawn({ speakers: NOBODY, error: VOICE_FAILURE.OPENAI_KEY_MISSING });
  assert.deepEqual(standing(), []);

  redrawn({ speakers: NOBODY, error: VOICE_FAILURE.CALL_NOT_STARTED });
  assert.deepEqual(standing(), ["Luke could not start the call. Try again in a moment."]);
});

test("a temporary unavailability stands as a notice, said politely rather than as an alert", () => {
  drawn({ speakers: NOBODY, notice: VOICE_FAILURE.VOICE_UNAVAILABLE });
  const words = "Voice is temporarily unavailable. Try again later.";
  assert.deepEqual(standing(), [words]);
  assert.equal(said("status"), words);
  assert.equal(said("alert"), "");
});

test("while Luke speaks into a Mac whose output is off, a toast says so, politely, led by the speaker, with a Hide that quiets it", () => {
  const dismissed: string[] = [];
  drawn({
    speakers: LUKE_SPEAKING,
    silent: true,
    onDismissHint: () => dismissed.push("got it"),
  });
  assert.deepEqual(standing(), [HINT]);
  assert.equal(said("status"), HINT);
  const glyph = document.querySelector(".luke-toast:not([data-leaving]) .luke-toast-glyph");
  assert.equal(glyph?.innerHTML.includes(renderToStaticMarkup(createElement(SpeakerIcon))), true);
  act(() => toastControl("Hide").click());
  assert.deepEqual(dismissed, ["got it"]);
});

test("the volume hint leaves at once when it is answered, while a failure lingers a toast's Done hold to be read and then leaves", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  drawn({ speakers: LUKE_SPEAKING, silent: true });
  redrawn({ speakers: LUKE_SPEAKING, silent: false });
  assert.deepEqual(standing(), [], "no stale hint or Hide after it was answered");

  const words = "Luke could not start the call. Try again in a moment.";
  redrawn({ speakers: NOBODY, error: VOICE_FAILURE.CALL_NOT_STARTED });
  redrawn({ speakers: NOBODY });
  const linger = Duration.toMillis(TOAST_HOLD.DONE);
  pass(linger - 1);
  assert.deepEqual(standing(), [words], "a failure stays a moment so it is read");
  pass(1);
  assert.deepEqual(standing(), []);
});
