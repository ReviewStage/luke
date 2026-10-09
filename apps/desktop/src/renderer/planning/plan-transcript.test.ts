// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { PlanTranscript } from "./plan-transcript";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "./transcript-model";

/** Synthetic words throughout. */
function said(count: number): TranscriptRegion {
  return {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 1_000,
        live: true,
        messages: Array.from({ length: count }, (_, index) => ({
          id: String(index),
          role: TRANSCRIPT_SPEAKER.USER,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: `Line ${index}` }],
        })),
      },
    ],
  };
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The list's scroll box as jsdom lays it out: a fixed height over a content height the test sets. */
function scrollBox(container: HTMLElement, contentHeight: number): HTMLElement {
  const box = container.querySelector<HTMLElement>('[role="log"]');
  assert.ok(box);
  Object.defineProperty(box, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(box, "scrollHeight", { configurable: true, value: contentHeight });
  return box;
}

test("each line is drawn under its speaker, the developer's and Luke's told apart", () => {
  const drawn = renderToStaticMarkup(
    createElement(PlanTranscript, {
      region: {
        kind: TRANSCRIPT_REGION.READY,
        earlierOmitted: false,
        calls: [
          {
            key: "call-1",
            startedAt: 1_000,
            live: false,
            messages: [
              {
                id: "0",
                role: TRANSCRIPT_SPEAKER.USER,
                parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Invites should expire." }],
              },
              {
                id: "1",
                role: TRANSCRIPT_SPEAKER.ASSISTANT,
                parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "After how many days?" }],
              },
            ],
          },
        ],
      },
      onRetry: () => undefined,
    }),
  );
  assert.match(drawn, /class="plan-transcript ph-no-capture"/u);
  assert.match(
    drawn,
    /You<\/span>.*Invites should expire\..*Luke<\/span>.*After how many days\?/su,
  );
  assert.match(drawn, /is-user.*is-assistant/su);
});

test("the empty, reading, and failed states each say where the transcript stands, and a failure offers Try again", () => {
  const empty = renderToStaticMarkup(
    createElement(PlanTranscript, {
      region: { kind: TRANSCRIPT_REGION.EMPTY },
      onRetry: () => undefined,
    }),
  );
  assert.match(empty, /Nothing said yet — start a call and the transcript appears here\./u);

  const reading = renderToStaticMarkup(
    createElement(PlanTranscript, {
      region: { kind: TRANSCRIPT_REGION.READING },
      onRetry: () => undefined,
    }),
  );
  assert.match(reading, /aria-busy="true"/u);

  let retried = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanTranscript, {
        region: { kind: TRANSCRIPT_REGION.FAILED },
        onRetry: () => {
          retried += 1;
        },
      }),
    ),
  );
  assert.equal(
    container.querySelector('[role="alert"]')?.textContent,
    "The transcript could not be read.",
  );
  act(() => container.querySelector<HTMLButtonElement>("button")?.click());
  assert.equal(retried, 1);
});

test("a new line keeps the list at its newest, unless the developer scrolled up to read", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (region: TranscriptRegion) =>
    act(() => root.render(createElement(PlanTranscript, { region, onRetry: () => undefined })));

  draw(said(1));
  const box = scrollBox(container, 1_000);
  draw(said(2));
  assert.equal(box.scrollTop, 1_000);

  // Scrolled up: a new line leaves the list where the developer put it.
  box.scrollTop = 200;
  act(() => box.dispatchEvent(new Event("scroll")));
  scrollBox(container, 1_200);
  draw(said(3));
  assert.equal(box.scrollTop, 200);

  // Back at the bottom: the list follows again.
  box.scrollTop = 800;
  act(() => box.dispatchEvent(new Event("scroll")));
  scrollBox(container, 1_400);
  draw(said(4));
  assert.equal(box.scrollTop, 1_400);
});
