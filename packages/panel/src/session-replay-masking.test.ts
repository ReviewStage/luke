// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PRODUCT_PLATFORM } from "@luke/features/analytics";
import { afterEach, expect, test, vi } from "vitest";
import { sessionReplay } from "./session-replay.js";

/**
 * session-replay-masking.test.ts -- what a recording masks, read as the recorder is told it: every attribute but the ones the replay lays out by is asterisked, a link's address goes unless it is a stylesheet's or an icon's symbol, and an id goes unless it is one an icon draws through.
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
    platform: PRODUCT_PLATFORM.DESKTOP,
    projectApiKey: () => "test-project-key",
    host: { api: "https://us.i.posthog.com", ui: "https://us.posthog.com" },
    address: "app://desktop/panel",
    namesOwnAddress: () => false,
    importRecorder: () => Promise.resolve(undefined),
  })({ permitted: true, appVersion: "0.0.0", packaged: true, accountId: "user-1" });
  await vi.waitFor(() => expect(client.init).toHaveBeenCalledOnce());
  const options = client.init.mock.calls[0]?.[1] as {
    session_recording: { maskAttributeFn: Mask };
  };
  return options.session_recording.maskAttributeFn;
}

test("a recording asterisks every attribute it does not lay out by, those that carry words, names, and ids among them", async () => {
  const masked = await mask();
  const row = document.createElement("div");
  for (const name of [
    "title",
    "aria-label",
    "aria-valuetext",
    "alt",
    "placeholder",
    "src",
    "srcset",
    "content",
    "data-motion-key",
    "data-value",
    "data-threads",
    "id",
    "aria-labelledby",
    "for",
    "name",
    "value",
    "xlink:href",
    "rr_src",
    "download",
  ]) {
    assert.equal(masked(name, "acme/launch", row), "***********", name);
  }
});

test("a recording leaves the attributes it lays out by, a link's address only where it is an icon's or a stylesheet's, and an id only where an icon draws through it", async () => {
  const masked = await mask();
  const svg = (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag);
  assert.equal(masked("class", "ui-one-line"), "ui-one-line");
  assert.equal(masked("style", "width: 40%;"), "width: 40%;");
  assert.equal(masked("role", "menuitem"), "menuitem");
  assert.equal(masked("aria-expanded", "true"), "true");
  assert.equal(masked("data-ui-theme", "dark"), "dark");
  assert.equal(masked("viewBox", "0 0 16 16", svg("svg")), "0 0 16 16");
  assert.equal(masked("rr_width", "120px"), "120px");
  assert.equal(masked("_cssText", ".row { margin: 0; }"), ".row { margin: 0; }");
  assert.equal(
    masked("href", "https://x.test/?t=1", document.createElement("a")),
    "*******************",
  );
  assert.equal(masked("href", "#glyph", svg("use")), "#glyph");
  assert.equal(masked("id", "glyph", svg("symbol")), "glyph");
  assert.equal(masked("id", "glyph", document.createElement("div")), "*****");
  assert.equal(masked("id", "root", document.createElement("div")), "root");
});
