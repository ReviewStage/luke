// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test } from "vitest";
import type { VoiceSpeakers } from "#shared/messages/voice-view";
import { LukeIdentity, voiceStatus } from "./luke-identity";

const quiet = { listening: false, lukeSpeaking: false };

/** The card as the sidebar draws it, parsed so a test reads what it shows. */
function identity(speakers: VoiceSpeakers, voiceOpening = false): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(LukeIdentity, {
      speakers,
      voiceActive: { developer: false, luke: false },
      fixtureSpeaking: false,
      voiceOpening,
    }),
  );
  return host;
}

beforeEach(() => {
  // Luke's face reads the reduced-motion preference, which jsdom has no media for.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

test("with no call the card is Luke's face and name, and its status line says nothing", () => {
  const card = identity(quiet);

  assert.equal(card.querySelector(".luke-identity-name")?.textContent, "Luke");
  assert.equal(card.querySelector("[role=status]")?.textContent, "");
  assert.equal(card.textContent, "Luke");
});

test("during a call the card says what the voice is doing", () => {
  assert.equal(identity(quiet, true).querySelector("[role=status]")?.textContent, "Connecting");
  assert.equal(
    identity({ ...quiet, listening: true }).querySelector("[role=status]")?.textContent,
    "Listening",
  );
  assert.equal(
    identity({ ...quiet, lukeSpeaking: true }).querySelector("[role=status]")?.textContent,
    "Speaking",
  );
});

test("a quiet voice has no status to say", () => {
  assert.equal(voiceStatus({ speakers: quiet, voiceOpening: false }), undefined);
});

test("a call still opening says it is connecting", () => {
  assert.equal(voiceStatus({ speakers: quiet, voiceOpening: true }), "Connecting");
});

test("an open microphone says it is listening, even while the call settles", () => {
  assert.equal(
    voiceStatus({ speakers: { ...quiet, listening: true }, voiceOpening: true }),
    "Listening",
  );
});

test("Luke speaking over an open microphone says he is speaking", () => {
  assert.equal(
    voiceStatus({ speakers: { listening: true, lukeSpeaking: true }, voiceOpening: false }),
    "Speaking",
  );
});
