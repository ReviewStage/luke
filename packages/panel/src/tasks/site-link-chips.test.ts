// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MARK_PROVIDER, ProviderMark } from "@luke/ui";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * site-link-chips.test.ts -- a link to a well-known site's page in words is
 * drawn as its chip: Google Maps's own pin, and the place, search, or route
 * its address spells, a labelled link keeping its label. Synthetic places.
 */

const PLACE = "https://www.google.com/maps/place/Ferry+Building/@37.79,-122.39,17z/data=!3m1";
const ROUTE = "https://www.google.com/maps/dir/SFO/Ferry+Building/@37.7,-122.3,11z";

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The words drawn. */
async function drawn(text: string): Promise<HTMLElement> {
  const state = signedInAs({ id: "user-sam", email: "sam@example.com", name: "Sam Okafor" });
  fakeAppBridge({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
  });
  fakeActPort({});
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(onRegistry(AtomRegistry.make(), createElement(TranscriptWords, { text }))),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

test("a Google Maps link is a chip wearing Maps's pin and called by its place, its route, or its label", async () => {
  const container = await drawn(`Meet at ${PLACE}, via ${ROUTE}, or [the pier](${PLACE}).`);
  const chips = [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")];
  const pin = renderToStaticMarkup(
    createElement(ProviderMark, { provider: MARK_PROVIDER.GOOGLE_MAPS }),
  );

  assert.deepEqual(
    chips.map((chip) => chip.querySelector(".luke-inline-ref-label")?.textContent),
    ["Ferry Building", "SFO → Ferry Building", "the pier"],
  );
  for (const chip of chips) assert.equal(chip.querySelector("svg")?.outerHTML, pin);
});
