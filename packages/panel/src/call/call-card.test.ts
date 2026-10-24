// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BUTTON_VARIANT, CALL_CONTROL_LABEL } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { CALL_CARD_SURFACE, CallCard } from "./call-card.js";

/**
 * call-card.test.ts -- the call card's End call is the one End call every
 * place a call is steered from draws: the danger button wearing the hang-up
 * glyph, which hands its press back. Synthetic task.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

test("the card's End call is the danger button with the hang-up glyph, and its press ends the call", () => {
  const ended: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(CallCard, {
        card: { taskName: "Invite expiry", status: undefined, microphoneMuted: false },
        speakerMuted: false,
        controls: {
          onReturn: () => undefined,
          onToggleMicrophone: () => undefined,
          onToggleSpeaker: () => undefined,
          onEnd: () => ended.push("end"),
        },
        surface: CALL_CARD_SURFACE.SIDEBAR,
      }),
    ),
  );
  const end = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${CALL_CONTROL_LABEL.END_CALL}"]`,
  );
  assert.ok(end, "the card offers End call");
  assert.equal(end.dataset.variant, BUTTON_VARIANT.DANGER);
  assert.equal(
    end.querySelector("svg")?.outerHTML,
    renderToStaticMarkup(createElement(GLYPH.END_CALL)),
  );
  act(() => end.click());
  assert.deepEqual(ended, ["end"]);
});
