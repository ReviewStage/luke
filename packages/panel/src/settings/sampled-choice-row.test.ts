// @vitest-environment jsdom

import assert from "node:assert/strict";
import { holdExits } from "@luke/ui/testing/held-exits";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { SampledChoiceRow } from "./sampled-choice-row.js";

/**
 * Settings' voice choice as the developer meets it: a chip that opens a card
 * of every voice, each played as it is picked; putting the card away, by
 * Cancel, silences the voice at once, not when its fade has run.
 */

const OPTIONS = [
  { value: "ada", label: "Ada", sample: "voices/ada.mp3" },
  { value: "bea", label: "Bea", sample: "voices/bea.mp3" },
];

const roots: Root[] = [];
/** Every clip the card started, and whether each was paused. */
let clips: { src: string; paused: boolean }[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  clips = [];
  // jsdom plays no audio, so a clip is only a record of being started and paused.
  vi.stubGlobal(
    "Audio",
    class {
      readonly clip: { src: string; paused: boolean };
      constructor(src: string) {
        this.clip = { src, paused: false };
        clips.push(this.clip);
      }
      addEventListener(): void {}
      play(): Promise<void> {
        return Promise.resolve();
      }
      pause(): void {
        this.clip.paused = true;
      }
    },
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

const button = (words: string | RegExp) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
    typeof words === "string" ? each.textContent === words : words.test(each.textContent ?? ""),
  ) ?? assert.fail(`no ${String(words)} button`);

test("Cancel silences the voice being sampled while the card is still fading out", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SampledChoiceRow, {
        label: "Voice",
        changed: false,
        value: "ada",
        options: OPTIONS,
        onChange: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      }),
    ),
  );
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Voice: Ada"]')?.click());
  act(() => document.querySelectorAll<HTMLElement>('[role="radio"]')[1]?.click());
  const started = clips.length;

  act(() => button("Cancel").click());
  const fading = document.querySelector('[role="dialog"]') !== null;
  const silent = clips.every((clip) => clip.paused);
  act(() => vi.advanceTimersToNextFrame());
  await act(async () => exits.finish());

  assert.equal(started, 1, "picking a voice plays it");
  assert.equal(fading, true, "the card stands while it fades");
  assert.equal(silent, true, "the voice stops as the card is put away");
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
