// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, expect, test, vi } from "vitest";
import { sessionReplay } from "./session-replay.js";

/**
 * session-replay-masking.test.ts -- what a recording masks, read as the recorder is told it: every attribute that carries words is asterisked, a layout one is left, and a link's address goes unless it is a stylesheet's or an icon's symbol.
 */

type Mask = (name: string, value: string, element?: Element) => string;

const client = vi.hoisted(() => ({
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  register: vi.fn(),
  identify: vi.fn(),
  startSessionRecording: vi.fn(),
}));

vi.mock("posthog-js/dist/module.no-external", () => ({ default: client }));

afterEach(() => {
  vi.clearAllMocks();
  delete window.__PosthogExtensions__;
});

/** Starts a recording through the controller and answers the attribute mask the recorder was handed. */
async function mask(): Promise<Mask> {
  window.__PosthogExtensions__ = { initSessionRecording: () => undefined };
  sessionReplay({
    appName: "desktop",
    projectApiKey: () => "test-project-key",
    address: "luke://panel",
    namesOwnAddress: () => false,
    importRecorder: () => Promise.resolve(undefined),
  })({ permitted: true, appVersion: "0.0.0", packaged: true, accountId: undefined });
  await vi.waitFor(() => expect(client.init).toHaveBeenCalledOnce());
  const options = client.init.mock.calls[0]?.[1] as {
    session_recording: { maskAttributeFn: Mask };
  };
  return options.session_recording.maskAttributeFn;
}

test("a recording asterisks the attributes that carry words, a video's running time and a control's role description among them", async () => {
  const masked = await mask();
  for (const name of [
    "title",
    "aria-label",
    "aria-description",
    "aria-placeholder",
    "aria-valuetext",
    "aria-roledescription",
    "alt",
    "placeholder",
    "src",
    "content",
  ]) {
    assert.equal(masked(name, "0:42 of 3:10"), "************", name);
  }
});

test("a recording leaves the attributes it lays out by, and a link's address goes unless it is an icon's or a stylesheet's", async () => {
  const masked = await mask();
  assert.equal(masked("class", "luke-one-line"), "luke-one-line");
  const anchor = document.createElement("a");
  assert.equal(masked("href", "https://x.test/?t=1", anchor), "*******************");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "use");
  assert.equal(masked("href", "#glyph", icon), "#glyph");
});
