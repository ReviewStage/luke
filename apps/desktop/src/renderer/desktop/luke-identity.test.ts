// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test } from "vitest";
import { LukeIdentity } from "./luke-identity";

beforeEach(() => {
  // Luke's face reads the reduced-motion preference, which jsdom has no media for.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

test("the head of the sidebar is Luke's face and name alone: no voice status, no meter, and a face at rest", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(LukeIdentity));
  assert.equal(host.textContent, "Luke");
  assert.equal(host.querySelector("[role=status]") === null, true);
  assert.equal(host.querySelector(".waveform") === null, true);
  assert.equal(host.querySelector(".luke-face")?.hasAttribute("data-motion"), false);
});
