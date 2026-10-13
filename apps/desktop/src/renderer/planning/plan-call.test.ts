// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkState,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/hosted/transcript-wire";
import {
  LIVE_CLOSE_REASON,
  LIVE_DEFAULTS,
  TRANSCRIPT_SPEAKER,
  type TranscriptSpeaker,
} from "@sidecar/live";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import { ACT_KIND } from "#shared/messages/acts";
import { installActBridge } from "#testing/act-bridge";
import { installClipboard, onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { PAST_SPINNER_DELAY, waitsIn } from "#testing/spinner";
import { PlanCall } from "./plan-call";
import {
  type CallRecord,
  TRANSCRIPT_REGION,
  type TranscriptRegion,
  transcriptRegion,
} from "./transcript-model";

/** The Call tab as a test draws it: what it is given over a plan with no planning turn, which reads no older page and opens nothing. */
function callTab(
  props: Partial<Parameters<typeof PlanCall>[0]> & Pick<Parameters<typeof PlanCall>[0], "region">,
) {
  return createElement(PlanCall, {
    onRetry: () => undefined,
    turns: [],
    callLive: false,
    earlier: undefined,
    onLoadEarlier: () => Promise.resolve(),
    onOpenSubagent: () => undefined,
    shown: true,
    ...props,
  });
}

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
  vi.restoreAllMocks();
});

/** The list's scroll box as jsdom lays it out: a fixed height over a content height the test sets. */
function scrollBox(container: HTMLElement, contentHeight: number): HTMLElement {
  const box = container.querySelector<HTMLElement>('[role="log"]');
  assert.ok(box);
  Object.defineProperty(box, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(box, "scrollHeight", { configurable: true, value: contentHeight });
  return box;
}

test("each line is drawn as a coding agent's tab draws a message, the developer's a bubble and Luke's the agent's, under no label", () => {
  const drawn = renderToStaticMarkup(
    callTab({
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
  assert.match(drawn, /<section class="plan-call ph-no-capture" aria-label="Call">/u);
  assert.match(drawn, /is-user.*Invites should expire\..*is-assistant.*After how many days\?/su);
  assert.doesNotMatch(drawn, /Luke<\/span>|luke-face/u, "Luke's words stand under no label of his");
});

test("a spoken line that reads as a markdown image draws no image, so the tab asks nothing of its address", () => {
  const drawn = renderToStaticMarkup(
    callTab({
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

test("a link in a spoken line opens in the browser over the act channel, a GitHub page through github.open and any other web page through web.open, and an address the browser should not open is words that go nowhere", () => {
  const sent = installActBridge();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const region: TranscriptRegion = {
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
            role: TRANSCRIPT_SPEAKER.ASSISTANT,
            parts: [
              {
                type: TRANSCRIPT_PART_TYPE.TEXT,
                text: `See [the pull request](https://github.com/acme/relay/pull/7), [the docs](https://example.test/docs), [a script](javascript:alert(1)), [a file](file:///etc/passwd), [mail](mailto:dean@example.test), [an app](luke://plan/7), and [a long one](https://example.test/?q=${"a".repeat(2_048)}).`,
              },
            ],
          },
        ],
      },
    ],
  };
  act(() => root.render(callTab({ region, onRetry: () => undefined })));

  // Note that Streamdown blocks a script's, a file's, and an app's scheme
  // before the link is ours to draw; a mail address and an address past the
  // act's cap are ours to refuse.
  assert.deepEqual(
    [...container.querySelectorAll("a")].map((link) => link.getAttribute("href")),
    ["https://github.com/acme/relay/pull/7", "https://example.test/docs"],
  );
  assert.deepEqual(
    [...container.querySelectorAll(".agent-link-inert")].map((inert) => inert.textContent),
    ["mail", "a long one"],
  );
  assert.equal(
    container.querySelector(".agent-link-inert")?.getAttribute("title"),
    "mailto:dean@example.test",
  );
  const clicks = [...container.querySelectorAll<HTMLAnchorElement>("a")].map((link) => {
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    return click.defaultPrevented;
  });
  assert.deepEqual(clicks, [true, true]);
  assert.deepEqual(sent, [
    { kind: ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/acme/relay/pull/7" } },
    { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.test/docs" } },
  ]);
});

test("the empty and failed states each say where the transcript stands, the empty one under the Call tab's glyph drawn large, and a failure offers Retry", () => {
  const empty = renderToStaticMarkup(
    callTab({
      region: { kind: TRANSCRIPT_REGION.EMPTY },
      onRetry: () => undefined,
    }),
  );
  assert.match(empty, /Nothing said yet — start a call and the transcript appears here\./u);
  assert.match(empty, /<span class="empty-state-icon" aria-hidden="true"><svg/u);

  let retried = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      callTab({
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

it.effect(
  "a read out draws the spinner in the transcript's place once it has stood, saying Loading transcript to a reader",
  () =>
    Effect.gen(function* () {
      const registry = yield* registryOnTestClock;
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      act(() =>
        root.render(
          onRegistry(
            registry,
            callTab({
              region: { kind: TRANSCRIPT_REGION.READING },
              onRetry: () => undefined,
            }),
          ),
        ),
      );
      assert.deepEqual(waitsIn(container), [{ says: "", ring: false }], "nothing flashes at once");
      yield* TestClock.adjust(PAST_SPINNER_DELAY);
      yield* settle;
      assert.deepEqual(waitsIn(container), [{ says: "Loading transcript", ring: true }]);
      assert.doesNotMatch(container.textContent ?? "", /Reading/u);
    }),
);

test("a new line keeps the list at its newest, unless the developer scrolled up to read", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (region: TranscriptRegion) =>
    act(() => root.render(callTab({ region, onRetry: () => undefined })));

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
      callTab({
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

  // The developer's two lines are one bubble at the right; Luke's turns are the agent's messages, under no mark.
  const turns = [...log.querySelectorAll(".is-user, .is-assistant")];
  assert.deepEqual(
    turns.map((turn) => (turn.classList.contains("is-user") ? "user" : "assistant")),
    ["user", "assistant", "assistant"],
  );
  const [developer, luke] = turns;
  assert.ok(developer?.textContent?.includes("Invites should expire."));
  assert.ok(developer?.textContent?.includes("After a week, say."));
  assert.equal(luke?.querySelector(".luke-face"), null);

  // The call's order is kept: the divider, the developer, Luke, the next divider, Luke.
  const order = [...log.querySelectorAll("[data-checkpoint], .is-user, .is-assistant")].map(
    (element) =>
      element.hasAttribute("data-checkpoint")
        ? "call"
        : element.classList.contains("is-user")
          ? "user"
          : "assistant",
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
        root.render(onRegistry(registry, callTab({ region: TWO_CALLS, onRetry: () => undefined }))),
      );
      const copy = container.querySelector<HTMLButtonElement>('.is-user button[aria-label="Copy"]');
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

/** A call that ended at five past three, twelve minutes and thirty-four seconds after it began, local time. */
const CALL_END = new Date(2026, 9, 12, 15, 4).getTime();
const CALL_START = CALL_END - (12 * 60 + 34) * 1_000;

/** The tab holding the calls given, each of one line of the developer's and ended, with what its record holds. */
function endedCalls(records: readonly (CallRecord | undefined)[]): TranscriptRegion {
  return {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: records.map((record, index) => ({
      key: `call-${index}`,
      startedAt: CALL_START,
      live: false,
      lukeEnded: false,
      messages: [
        {
          id: "0",
          role: TRANSCRIPT_SPEAKER.USER,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: "Invites should expire." }],
        },
      ],
      record,
    })),
  };
}

/** The tab drawn on the test's clock, with what each call closes on and the card a call's closing line hangs on hover. */
const drawnOnClock = (region: TranscriptRegion) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(CALL_END + 60_000);
    const registry = yield* registryOnTestClock;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(onRegistry(registry, callTab({ region, onRetry: () => undefined }))));
    yield* settle;
    return {
      closings: () => [...container.querySelectorAll("[role='log'] p")].map((p) => p.textContent),
      ended: () => [...container.querySelectorAll<HTMLElement>("[data-call-ended]")],
      hover: (target: Element) => {
        act(() => {
          target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
        });
        return document.body.querySelector<HTMLElement>("[data-call-card]");
      },
    };
  });

it.effect(
  "a call that ended closes on how long it ran and when, and its card says the voice model, when it began and ended, how it ended, and the seconds it was metered for",
  () =>
    Effect.gen(function* () {
      const tab = yield* drawnOnClock(
        endedCalls([
          {
            endedAt: CALL_END,
            ending: LIVE_CLOSE_REASON.CONNECTION_LOST,
            usage: { seconds: 760, confirmed: false },
            model: LIVE_DEFAULTS.MODEL,
          },
        ]),
      );
      const [ended] = tab.ended();
      assert.ok(ended);
      assert.equal(ended.textContent, "Call ended · 12m 34s · Today, 3:04 PM");
      assert.ok(ended.classList.contains("select-text"));
      assert.equal(
        ended.querySelector("time")?.getAttribute("datetime"),
        new Date(CALL_END).toISOString(),
      );

      // The whole line hangs the card, its length as much as its time.
      const card = tab.hover(ended.querySelector("[data-call-length]") ?? ended);
      assert.equal(card?.querySelector(".turn-card-model")?.textContent, "GPT Live 1");
      assert.equal(
        card?.querySelector(".turn-card-when")?.textContent,
        "Oct 12, 2026, 2:51 PM → 3:04 PM",
      );
      assert.equal(card?.querySelector(".turn-card-ending")?.textContent, "Dropped");
      assert.deepEqual(
        [...(card?.querySelectorAll(".turn-card-token") ?? [])].map((row) => [
          row.querySelector("dt")?.textContent,
          row.querySelector("dd")?.textContent,
        ]),
        [["Metered (estimated)", "12m 40s"]],
      );
    }),
);

it.effect(
  "a call whose record holds only its end hangs a card of when it ran alone, and one whose end is not on record closes with the bare line",
  () =>
    Effect.gen(function* () {
      const tab = yield* drawnOnClock(
        endedCalls([
          // A plain hang-up, metered for exactly as long as it ran.
          {
            endedAt: CALL_END,
            ending: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
            usage: { seconds: 754, confirmed: true },
          },
          undefined,
        ]),
      );
      assert.deepEqual(
        tab.closings().filter((line) => line?.startsWith("Call ended")),
        ["Call ended · 12m 34s · Today, 3:04 PM", "Call ended"],
      );
      const [ended] = tab.ended();
      assert.ok(ended);
      const card = tab.hover(ended);
      assert.ok(card);
      assert.equal(card.querySelector(".turn-card-head"), null);
      assert.equal(card.querySelector("dl"), null);
      assert.equal(card.textContent, "Oct 12, 2026, 2:51 PM → 3:04 PM");
    }),
);

test("asked for a call by a version's Open, the tab brings that call to the top of its log once the transcript is read, and says so once", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-reveal")) return new DOMRect(0, 520, 0, 0);
    if (this.getAttribute("role") === "log") return new DOMRect(0, 120, 300, 400);
    return new DOMRect();
  });
  const call = (key: string, startedAt: number, text: string) => ({
    key,
    startedAt,
    live: false,
    lukeEnded: false,
    messages: [
      {
        id: "0",
        role: TRANSCRIPT_SPEAKER.USER,
        parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
      },
    ],
  });
  const revealed = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (region: TranscriptRegion) =>
    act(() =>
      root.render(
        callTab({
          region,
          onRetry: () => undefined,
          reveal: { call: "call-2", onRevealed: revealed },
        }),
      ),
    );

  draw({ kind: TRANSCRIPT_REGION.READING });
  assert.equal(revealed.mock.calls.length, 0, "nothing is answered while the transcript is read");
  draw({
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [call("call-1", 1_000, "The first call."), call("call-2", 9_000, "The second call.")],
  });

  const mark = container.querySelector("[data-reveal]");
  assert.ok(mark);
  assert.equal(container.querySelectorAll("[data-reveal]").length, 1);
  assert.match(
    mark.parentElement?.textContent?.split("The first call.")[1] ?? "",
    /The second call\./u,
  );
  assert.equal(container.querySelector<HTMLElement>('[role="log"]')?.scrollTop, 400);
  assert.equal(revealed.mock.calls.length, 1);
});

test("a call brought into view stays there through the redraw its answer asks and a line arriving after", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-reveal")) return new DOMRect(0, -1_480, 0, 0);
    if (this.getAttribute("role") === "log") return new DOMRect(0, 120, 300, 400);
    return new DOMRect();
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute("role") === "log" ? 2_000 : 0;
  });
  const call = (key: string, startedAt: number, lines: readonly string[]) => ({
    key,
    startedAt,
    live: false,
    lukeEnded: false,
    messages: lines.map((text, at) => ({
      id: String(at),
      role: TRANSCRIPT_SPEAKER.USER,
      parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
    })),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  let reveal: { call: string; onRevealed: () => void } | undefined = {
    call: "call-1",
    onRevealed: () => {
      reveal = undefined;
    },
  };
  const draw = (lines: readonly string[]) =>
    act(() =>
      root.render(
        callTab({
          region: {
            kind: TRANSCRIPT_REGION.READY,
            earlierOmitted: false,
            calls: [call("call-1", 1_000, ["The first call."]), call("call-2", 9_000, lines)],
          },
          onRetry: () => undefined,
          reveal,
        }),
      ),
    );

  draw(["The second call."]);
  const log = container.querySelector<HTMLElement>('[role="log"]');
  assert.equal(log?.scrollTop, 400);
  draw(["The second call.", "A line after."]);
  assert.equal(log?.scrollTop, 400, "the log does not jump back to its newest line");
});

/** The tab drawn into the page, for a test to read as a reader would. */
function mounted(element: ReturnType<typeof callTab>): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A line said on a call, naming the row the voice wrote for it, as the record answers it. */
function saidLine(id: string, role: TranscriptSpeaker, text: string, rowId: string) {
  return {
    id,
    role,
    parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
    metadata: { rowIds: [rowId] },
  };
}

/** A planning turn that read a file and answered, asked for by the rows named. */
function readingTurn(turnId: string, state: PlanWorkState, asked: readonly string[]): PlanWorkTurn {
  return {
    turnId,
    startedAt: 2_000,
    ...(state === PLAN_WORK_STATE.RUNNING ? undefined : { endedAt: 9_000 }),
    state,
    earlierOmitted: false,
    ...(asked.length === 0 ? undefined : { asked }),
    parts: [
      {
        type: PLAN_WORK_PART.TOOL,
        id: "call-read",
        tool: PLAN_WORK_TOOL.REPOSITORY,
        name: "run_in_repository",
        state: PLAN_WORK_STATE.DONE,
        subject: "cat src/members/remove.ts",
        input: JSON.stringify({ command: "cat src/members/remove.ts" }),
        output: "export function removeMember() {}",
      },
      ...(state === PLAN_WORK_STATE.RUNNING
        ? []
        : [{ type: PLAN_WORK_PART.TEXT, text: "Removal already checks for an admin." }]),
    ],
  };
}

/** The call the developer asked Luke to check removal on, live or ended. */
function askingCall(live: boolean): TranscriptRegion {
  return {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 1_000,
        live,
        lukeEnded: false,
        messages: [
          saidLine("0", TRANSCRIPT_SPEAKER.USER, "Check how removal works.", "row-ask"),
          saidLine(
            "1",
            TRANSCRIPT_SPEAKER.ASSISTANT,
            "It already checks for an admin.",
            "row-said",
          ),
        ],
      },
    ],
  };
}

/** What a reader meets down the log, in order: the developer's bubbles, Luke's messages, his work, and the working line. */
function readDown(container: HTMLElement): string[] {
  const log = container.querySelector('[role="log"]');
  assert.ok(log);
  return [...log.querySelectorAll(".is-user, .is-assistant, [data-working]")].map((element) => {
    if (element.hasAttribute("data-working")) return "working";
    if (element.classList.contains("is-user")) return `you: ${element.textContent}`;
    return element.querySelector("[data-call-id], [data-worked]") === null
      ? `luke: ${element.textContent}`
      : "luke's work";
  });
}

test("Luke's work stands right under the line that asked for it, drawn as an agent's turn, its words left out where he said them aloud", () => {
  const container = mounted(
    callTab({
      region: askingCall(false),
      turns: [readingTurn("turn-1", PLAN_WORK_STATE.DONE, ["row-ask"])],
    }),
  );
  const drawn = readDown(container);
  assert.equal(drawn[0], "you: Check how removal works.");
  assert.equal(drawn[1], "luke's work");
  assert.match(drawn[2] ?? "", /^luke: It already checks for an admin\./u);
  assert.equal(drawn.length, 3);
  assert.equal(
    container.textContent?.includes("Removal already checks for an admin."),
    false,
    "what Luke was handed to say is said once, as he said it",
  );
  assert.match(container.querySelector("[data-worked]")?.textContent ?? "", /^Worked for 7s · /u);
});

test("a turn still working on the live call ends on the working line under it, ahead of what is said after", () => {
  const container = mounted(
    callTab({
      region: askingCall(true),
      turns: [readingTurn("turn-1", PLAN_WORK_STATE.RUNNING, ["row-ask"])],
      callLive: true,
    }),
  );
  assert.deepEqual(readDown(container).slice(0, 3), [
    "you: Check how removal works.",
    "luke's work",
    "working",
  ]);
});

test("on the call standing now, Luke's work stands under the line heard asking for it however much is said after, and his answer is drawn once, as he said it", () => {
  const heard = (speaker: TranscriptSpeaker, words: string, startMs: number) => ({
    rowId: `window-${startMs}`,
    speaker,
    words,
    startMs,
    endMs: startMs + 2_000,
  });
  const region = transcriptRegion({
    transcript: undefined,
    heard: [
      {
        planId: "plan-1",
        heardAt: 1_000,
        live: true,
        transcript: {
          voiceSessionId: "call-live",
          lines: [
            heard(TRANSCRIPT_SPEAKER.USER, "Check how removal works.", 0),
            heard(TRANSCRIPT_SPEAKER.ASSISTANT, "Hold on, I'm reading the repository.", 3_000),
            heard(TRANSCRIPT_SPEAKER.ASSISTANT, "It already checks for an admin.", 20_000),
            heard(TRANSCRIPT_SPEAKER.USER, "Good. Write that down.", 30_000),
          ],
        },
      },
    ],
  });
  // The service names the ask by its own row and where the line began, as the live call's work frame does.
  const finished: PlanWorkTurn = {
    ...readingTurn("turn-1", PLAN_WORK_STATE.DONE, ["service-row-ask"]),
    askedAt: [{ voiceSessionId: "call-live", fromMs: 0 }],
  };
  const container = mounted(callTab({ region, turns: [finished], callLive: true }));
  assert.deepEqual(readDown(container), [
    "you: Check how removal works.",
    "luke's work",
    "luke: Hold on, I'm reading the repository.It already checks for an admin.",
    "you: Good. Write that down.",
  ]);
  assert.equal(
    container.textContent?.includes("Removal already checks for an admin."),
    false,
    "what Luke was handed to say is said once, as he said it",
  );
});

test("a turn no line asked for keeps its words, since nothing said them aloud, and stands where it started", () => {
  const container = mounted(
    callTab({
      region: askingCall(false),
      turns: [readingTurn("turn-typed", PLAN_WORK_STATE.DONE, [])],
    }),
  );
  const drawn = readDown(container);
  assert.equal(drawn.at(-1), "luke's work");
  assert.ok(container.textContent?.includes("Removal already checks for an admin."));
});

test("a transcript that could not be read leaves Luke's work standing, saying so above it with Retry", () => {
  let retried = 0;
  const container = mounted(
    callTab({
      region: { kind: TRANSCRIPT_REGION.FAILED },
      turns: [readingTurn("turn-typed", PLAN_WORK_STATE.DONE, [])],
      onRetry: () => {
        retried += 1;
      },
    }),
  );
  assert.equal(
    container.querySelector('[role="alert"]')?.textContent,
    "The transcript could not be read.",
  );
  assert.deepEqual(readDown(container), ["luke's work"]);
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  act(() => retry?.click());
  assert.equal(retried, 1);
});

test("a turn that only answered in words Luke said aloud draws nothing of its own, yet a version's Open still lands where it stood", () => {
  const spokenOnly: PlanWorkTurn = {
    turnId: "turn-words",
    startedAt: 2_000,
    endedAt: 3_000,
    state: PLAN_WORK_STATE.DONE,
    earlierOmitted: false,
    asked: ["row-ask"],
    parts: [{ type: PLAN_WORK_PART.TEXT, text: "It already checks for an admin." }],
  };
  const container = mounted(
    callTab({
      region: askingCall(false),
      turns: [spokenOnly],
      reveal: { at: 2_500, onRevealed: () => undefined },
    }),
  );
  assert.deepEqual(readDown(container), [
    "you: Check how removal works.",
    "luke: It already checks for an admin.",
  ]);
  const mark = container.querySelector("[data-reveal]");
  assert.ok(mark, "the turn's place is still marked");
  assert.equal(mark.nextElementSibling?.classList.contains("is-assistant"), true);
});
