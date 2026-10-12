// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { installClipboard, onRegistry, registryOnTestClock } from "#testing/copy-feedback";
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
        lukeEnded: false,
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

/** Lets the clipboard's answer, and the redraw it causes, land with no time passing. */
const settle = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

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
            lukeEnded: false,
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

test("a spoken line that reads as a markdown image draws no image, so the tab asks nothing of its address", () => {
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
            lukeEnded: false,
            messages: [
              {
                id: "0",
                role: TRANSCRIPT_SPEAKER.USER,
                parts: [
                  {
                    type: TRANSCRIPT_PART_TYPE.TEXT,
                    text: "Look at ![the chart](https://example.test/chart.png) first.",
                  },
                ],
              },
            ],
          },
        ],
      },
      onRetry: () => undefined,
    }),
  );
  assert.doesNotMatch(drawn, /<img/u);
  assert.doesNotMatch(drawn, /example\.test/u);
  assert.match(drawn, /Look at/u);
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

/** Two calls on one plan, the second standing, with a run of the developer's lines on the first. */
const TWO_CALLS: TranscriptRegion = {
  kind: TRANSCRIPT_REGION.READY,
  earlierOmitted: false,
  calls: [
    {
      key: "call-1",
      startedAt: Date.UTC(2026, 9, 8, 15, 30),
      live: false,
      lukeEnded: false,
      messages: [
        {
          id: "0",
          role: TRANSCRIPT_SPEAKER.USER,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Invites should expire." }],
        },
        {
          id: "1",
          role: TRANSCRIPT_SPEAKER.USER,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "After a week, say." }],
        },
        {
          id: "2",
          role: TRANSCRIPT_SPEAKER.ASSISTANT,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "A week it is." }],
        },
      ],
    },
    {
      key: "call-2",
      startedAt: Date.UTC(2026, 9, 9, 9, 5),
      live: true,
      lukeEnded: false,
      messages: [
        {
          id: "3",
          role: TRANSCRIPT_SPEAKER.ASSISTANT,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Where were we?" }],
        },
      ],
    },
  ],
};

test("each call begins at a divider saying when it started, the standing one marked live, and one speaker's run of lines is one turn", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanTranscript, {
        region: TWO_CALLS,
        onRetry: () => undefined,
      }),
    ),
  );
  const log = container.querySelector('[role="log"]');
  assert.ok(log);

  // Two dividers, each a hairline after its words, the live call's saying so.
  const dividers = [...log.querySelectorAll("[data-checkpoint]")];
  assert.equal(dividers.length, 2);
  assert.ok(dividers[0]?.textContent?.includes(":"), "the first divider carries a time");
  assert.equal(dividers[0]?.textContent?.includes("Live"), false);
  assert.ok(dividers[1]?.textContent?.endsWith("Live"));
  assert.ok(dividers[1]?.querySelector("svg.lucide-audio-lines"), "a voice glyph, not a dot");
  assert.equal(dividers[1]?.querySelector(".rounded-full"), null);

  // The developer's two lines are one turn, in a bubble at the right; Luke's turns stand under his mark.
  const turns = [...log.querySelectorAll("[data-speaker]")];
  assert.deepEqual(
    turns.map((turn) => turn.getAttribute("data-speaker")),
    [TRANSCRIPT_SPEAKER.USER, TRANSCRIPT_SPEAKER.ASSISTANT, TRANSCRIPT_SPEAKER.ASSISTANT],
  );
  const [developer, luke] = turns;
  assert.ok(developer);
  assert.ok(developer.classList.contains("is-user"));
  assert.ok(developer.textContent?.includes("Invites should expire."));
  assert.ok(developer.textContent?.includes("After a week, say."));
  assert.equal(developer.querySelector(".luke-face"), null);
  assert.ok(luke);
  assert.ok(luke.classList.contains("is-assistant"));
  assert.ok(luke.querySelector(".luke-face"), "Luke's turn stands under his mark");

  // The call's order is kept: the divider, the developer, Luke, the next divider, Luke.
  const order = [...log.querySelectorAll("[data-checkpoint], [data-speaker]")].map((element) =>
    element.hasAttribute("data-checkpoint") ? "call" : element.getAttribute("data-speaker"),
  );
  assert.deepEqual(order, ["call", "user", "assistant", "call", "assistant"]);
});

it.effect(
  "a turn's copy hands the clipboard its lines, a paragraph each, and shows the check for a moment under the button's own name",
  () =>
    Effect.gen(function* () {
      const clipboard = installClipboard();
      const registry = yield* registryOnTestClock;
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      act(() =>
        root.render(
          onRegistry(
            registry,
            createElement(PlanTranscript, { region: TWO_CALLS, onRetry: () => undefined }),
          ),
        ),
      );
      const copy = container.querySelector<HTMLButtonElement>(
        '[data-speaker="user"] button[aria-label="Copy"]',
      );
      assert.ok(copy);
      act(() => copy.click());
      yield* settle;
      assert.deepEqual(clipboard.copied, ["Invites should expire.\n\nAfter a week, say."]);
      assert.equal(copy.querySelector('[role="status"]')?.textContent, "Copied");
      assert.equal(copy.getAttribute("aria-label"), "Copy");

      yield* TestClock.adjust(Duration.millis(1_200));
      yield* settle;
      assert.equal(copy.querySelector('[role="status"]')?.textContent, "");
    }),
);
