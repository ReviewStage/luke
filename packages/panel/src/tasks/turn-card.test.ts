import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TurnCard } from "./turn-card.js";

/**
 * A finished turn's card as a developer reads it: a turn that ran a fast
 * step at standard speed says so on a line of its own, and any other turn
 * says nothing of speed.
 */

const STARTED_AT = Date.UTC(2026, 9, 14, 12, 0, 0);
const ENDED_AT = STARTED_AT + 90_000;

function card(fastRefused?: boolean): string {
  return renderToStaticMarkup(
    createElement(TurnCard, {
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      record: {
        model: "anthropic/claude-opus-5.5-fast",
        effort: "high",
        ...(fastRefused === undefined ? undefined : { fastRefused }),
      },
      models: [],
    }),
  );
}

test("a turn Anthropic refused a fast step of says it ran at standard speed, and another turn says nothing of speed", () => {
  assert.match(card(true), /Fast wasn&#x27;t available, so this ran at standard speed/u);
  assert.doesNotMatch(card(), /standard speed/u);
  assert.doesNotMatch(card(false), /standard speed/u);
});
