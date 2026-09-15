import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { WINDOW_ROLE } from "#shared/messages/session";
import { surfaceFor } from "./surface-for";

/**
 * The role branch is what keeps the recorder out of the hidden voice window
 * now that both windows load one bundle: `App` is where recording starts, and
 * the voice role must never reach it.
 */
const surfaces = {
  panel: () => createElement("main", { "data-surface": "panel" }),
  voice: () => createElement("audio", { "data-surface": "voice" }),
};

test("the voice role mounts the voice surface and nothing of the panel", () => {
  const markup = renderToStaticMarkup(surfaceFor(WINDOW_ROLE.VOICE, surfaces));
  assert.equal(markup, '<audio data-surface="voice"></audio>');
});

test("a panel mounts the panel's surface", () => {
  const markup = renderToStaticMarkup(surfaceFor(WINDOW_ROLE.PANEL, surfaces));
  assert.equal(markup, '<main data-surface="panel"></main>');
});
