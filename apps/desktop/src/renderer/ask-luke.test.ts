import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskLuke, STOP_LABEL } from "./ask-luke";

/** The label as static markup carries it: the apostrophe escaped, as React writes attributes. */
const STOP_LABEL_MARKUP = STOP_LABEL.replaceAll("'", "&#x27;");

const props = {
  ask: async () => undefined,
  onEngagedChange: () => undefined,
  rowIndex: 1,
};

test("the disc sends until a run of Luke's is going, and is its stop while one is", () => {
  const idle = renderToStaticMarkup(createElement(AskLuke, props));
  assert.match(idle, /data-turn="you"/);
  assert.match(
    idle,
    /type="submit" class="ask-luke-send" aria-label="Ask Luke" title="Ask Luke" disabled=""/,
  );
  assert.doesNotMatch(idle, new RegExp(STOP_LABEL_MARKUP));

  const thinking = renderToStaticMarkup(
    createElement(AskLuke, { ...props, thinking: true, onStop: () => undefined }),
  );
  // The same button in its other state: lit whatever the field holds, named
  // for what it does, and a button rather than the form's submit.
  assert.match(thinking, /data-turn="luke"/);
  assert.match(
    thinking,
    new RegExp(
      `type="button" class="ask-luke-send" aria-label="${STOP_LABEL_MARKUP}" title="${STOP_LABEL_MARKUP}"`,
    ),
  );
  assert.doesNotMatch(thinking, /disabled/);
});

test("a run going with nothing to stop it through leaves the disc the send it was", () => {
  const markup = renderToStaticMarkup(createElement(AskLuke, { ...props, thinking: true }));
  assert.match(markup, /data-turn="you"/);
  assert.match(markup, /aria-label="Ask Luke"/);
});
