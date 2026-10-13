// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { it } from "@effect/vitest";
import {
  CODING_AGENT_DELEGATE_TOOL,
  TURN_ENDING,
  type TurnRecord,
} from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkState,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { MESSAGE_ROLE } from "@sidecar/wire";
import { Duration, Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { rendererRuntime } from "../renderer-runtime";
import { AgentTranscriptView } from "./agent-tab";
import { PlanCall } from "./plan-call";
import { spanText } from "./plan-time";
import { SubagentTab } from "./plan-work";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "./transcript-model";
import { workerOf, workRowsOf } from "./work-model";
import {
  STATUS_LINE_CLASS,
  WorkingLine,
  workedForText,
  workingClock,
  workingTime,
} from "./working-time";

/** A plan on which nothing was said yet, so the Call tab draws Luke's turns alone. */
const NO_CALLS: TranscriptRegion = { kind: TRANSCRIPT_REGION.EMPTY };

/** React's act warns outside an environment that says it is a test. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Lets a tick the clock fired reach the registry and React draw what it changed. */
const drawn = Effect.promise(() => act(async () => undefined));

/** Moves the test's clock, then lets what fell due be drawn. */
const advance = (by: Duration.Input) => Effect.andThen(TestClock.adjust(by), drawn);

/**
 * What is drawn mounted on a registry whose runtime is this test's own, so
 * the clock a count reads is the TestClock the test moves; answered with
 * its text now, its count, a redraw, and the unmount.
 */
const mounted = (element: ReactElement) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const registry = AtomRegistry.make({
      initialValues: [[rendererRuntime, AsyncResult.success(context)]],
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    const draw = (next: ReactElement) =>
      act(() => root.render(createElement(RegistryContext.Provider, { value: registry }, next)));
    draw(element);
    yield* drawn;
    return {
      text: () => container.textContent,
      timer: () => container.querySelector("[role='timer']")?.textContent ?? null,
      timers: () =>
        [...container.querySelectorAll("[role='timer']")].map((timer) => timer.textContent),
      worked: () => container.querySelector("[data-worked]"),
      /** The card the finished line hangs once the pointer rests on the part of it named (its whole line unless said), or nothing where it hangs none. */
      hoverWorked: (part = "[data-worked]") => {
        const target = container.querySelector(part);
        assert.ok(target, `no ${part} to hover`);
        act(() => {
          target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
        });
        return document.body.querySelector<HTMLElement>("[data-turn-card]");
      },
      working: () => container.querySelector("[data-working]"),
      draw: (next: ReactElement) =>
        Effect.andThen(
          Effect.sync(() => draw(next)),
          drawn,
        ),
      unmount: () => {
        act(() => root.unmount());
        // The card hangs at the body's end, past the container the test drew in.
        for (const card of document.body.querySelectorAll("[role='tooltip']")) card.remove();
      },
    };
  });

/** An agent's transcript of one line of the developer's, working on the run given or ended. */
const transcript = (run: { working: boolean; startedAt?: number; ended?: string }) =>
  createElement(AgentTranscriptView, {
    messages: [{ id: "m1", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Plan" }] }],
    reading: false,
    failed: false,
    onRetry: () => undefined,
    ...run,
  });

/** The Call tab holding one of Luke's turns, begun three minutes before the clock's zero, in the state given, on screen or not. */
const work = (state: PlanWorkState, shown: boolean) =>
  createElement(PlanCall, {
    region: NO_CALLS,
    onRetry: () => undefined,
    turns: [
      {
        turnId: "turn-1",
        startedAt: -3 * MINUTE,
        state,
        earlierOmitted: false,
        parts: [{ type: "text", text: "Reading the repository." }],
      },
    ],
    callLive: true,
    earlier: undefined,
    onLoadEarlier: () => Promise.resolve(),
    onOpenSubagent: () => undefined,
    shown,
  });

test("a run's length is said in seconds under a minute, minutes and seconds under an hour, and hours and minutes past it", () => {
  assert.equal(workingTime(0), "0s");
  assert.equal(workingTime(999), "0s");
  assert.equal(workingTime(42 * SECOND), "42s");
  assert.equal(workingTime(MINUTE - 1), "59s");
  assert.equal(workingTime(MINUTE), "1m 0s");
  assert.equal(workingTime(MINUTE + 12 * SECOND), "1m 12s");
  assert.equal(workingTime(HOUR - 1), "59m 59s");
  assert.equal(workingTime(HOUR), "1h 0m");
  assert.equal(workingTime(HOUR + 3 * MINUTE + 59 * SECOND), "1h 3m");
  assert.equal(workingTime(26 * HOUR), "26h 0m");
  // A start a moment ahead of this machine's clock is no time at all rather than a negative one.
  assert.equal(workingTime(-5 * SECOND), "0s");
});

it.effect("the clock a count reads says the time at once and again each second", () =>
  Effect.gen(function* () {
    const ticks = yield* Effect.forkChild(Stream.runCollect(Stream.take(workingClock, 3)));
    yield* TestClock.adjust(Duration.millis(999));
    assert.equal(ticks.pollUnsafe(), undefined);
    yield* TestClock.adjust(Duration.seconds(2));
    assert.deepEqual(yield* Fiber.join(ticks), [0, SECOND, 2 * SECOND]);
  }),
);

it.effect(
  "a working line counts up from its run's start each second, across the minute, and is selectable",
  () =>
    Effect.gen(function* () {
      const line = yield* mounted(createElement(WorkingLine, { startedAt: -58 * SECOND }));
      assert.equal(line.text(), "Working…58s");
      assert.equal(line.working()?.classList.contains("select-text"), true);
      yield* advance(Duration.seconds(1));
      assert.equal(line.text(), "Working…59s");
      yield* advance(Duration.seconds(1));
      assert.equal(line.text(), "Working…1m 0s");
      yield* advance(Duration.seconds(12));
      assert.equal(line.text(), "Working…1m 12s");
      line.unmount();
    }),
);

it.effect("a working line whose run's start is unknown only shimmers, with no count", () =>
  Effect.gen(function* () {
    const line = yield* mounted(createElement(WorkingLine, { startedAt: undefined }));
    yield* advance(Duration.seconds(5));
    assert.equal(line.text(), "Working…");
    assert.equal(line.timer(), null);
    line.unmount();
  }),
);

it.effect(
  "an agent's transcript counts its run while it works, and the count goes with the line once it ends",
  () =>
    Effect.gen(function* () {
      const tab = yield* mounted(transcript({ working: true, startedAt: -71 * SECOND }));
      assert.equal(tab.timer(), "1m 11s");
      yield* advance(Duration.seconds(1));
      assert.equal(tab.timer(), "1m 12s");
      yield* tab.draw(transcript({ working: false, startedAt: -71 * SECOND, ended: "Stopped." }));
      yield* advance(Duration.seconds(5));
      assert.equal(tab.timer(), null);
      assert.doesNotMatch(tab.text() ?? "", /Working…/u);
      tab.unmount();
    }),
);

it.effect(
  "the Call tab's running turn counts from when it began while the tab is on screen, and a settled turn counts nothing",
  () =>
    Effect.gen(function* () {
      const tab = yield* mounted(work(PLAN_WORK_STATE.RUNNING, true));
      assert.equal(tab.timer(), "3m 0s");
      yield* advance(Duration.seconds(4));
      assert.equal(tab.timer(), "3m 4s");
      yield* tab.draw(work(PLAN_WORK_STATE.RUNNING, false));
      assert.equal(tab.timer(), null);
      yield* tab.draw(work(PLAN_WORK_STATE.DONE, true));
      assert.equal(tab.timer(), null);
      tab.unmount();
    }),
);

/** 3:42 PM on the developer's own clock, whatever zone the test runs in. */
const TURN_END = new Date(2026, 9, 12, 15, 42).getTime();

/** One of the agent's turns: a line of its words, begun 1m 18s before it ended, still written where it has no end. */
const agentTurn = (finished: boolean, record: TurnRecord = {}) => ({
  id: "turn-1",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [{ type: "text", text: "Added the tests." }],
  startedAt: TURN_END - 78 * SECOND,
  ...(finished ? { finishedAt: TURN_END } : undefined),
  ...record,
});

const OPUS: CatalogModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high"],
};

const SOL: CatalogModel = {
  id: "openai/gpt-6.1-sol",
  name: "GPT-6.1 Sol",
  provider: MODEL_PROVIDER.OPENAI,
  efforts: ["low", "medium", "high"],
};

/** What a finished turn on Opus recorded: its model and effort, and the tokens its steps summed. */
const OPUS_TURN: TurnRecord = {
  model: OPUS.id,
  effort: "high",
  tokens: { inputTokens: 397_434, outputTokens: 660, cachedInputTokens: 396_430 },
};

/** A card's token rows as a reader takes them in: each label and its count. */
const tokenRows = (card: HTMLElement | null) =>
  [...(card?.querySelectorAll(".turn-card-token") ?? [])].map((row) => [
    row.querySelector("dt")?.textContent,
    row.querySelector("dd")?.textContent,
  ]);

/** An agent's transcript of one finished turn, its record as given. */
const finishedAgent = (record: TurnRecord) =>
  createElement(AgentTranscriptView, {
    messages: [agentTurn(true, record)],
    delegation: { models: [OPUS] },
    reading: false,
    failed: false,
    working: false,
    onRetry: () => undefined,
  });

/** One of the agent's turns handing a worker a task, the call running or answered. */
const delegatingTurn = (running: boolean) => ({
  id: "turn-1",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    {
      type: `tool-${CODING_AGENT_DELEGATE_TOOL}`,
      toolCallId: "call-worker",
      state: running ? "input-available" : "output-available",
      input: { task: "Count the routes." },
      ...(running ? undefined : { output: { model: "m", effort: "low", result: "Twelve." } }),
    },
  ],
});

/** The Call tab holding one turn whose worker began 42 seconds before the clock's zero, its call and session running or answered at the zero. */
const workerTurns = (running: boolean): readonly PlanWorkTurn[] => [
  {
    turnId: "turn-1",
    startedAt: -MINUTE,
    ...(running ? undefined : { endedAt: 0 }),
    state: running ? PLAN_WORK_STATE.RUNNING : PLAN_WORK_STATE.DONE,
    earlierOmitted: false,
    parts: [
      {
        type: PLAN_WORK_PART.TOOL,
        id: "call-worker",
        tool: PLAN_WORK_TOOL.WORKER,
        name: "worker",
        state: running ? PLAN_WORK_STATE.RUNNING : PLAN_WORK_STATE.DONE,
        subject: "Count the routes.",
        input: JSON.stringify({ message: "Count the routes." }),
        session: {
          earlierOmitted: false,
          parts: [{ type: PLAN_WORK_PART.TEXT, text: "Twelve routes." }],
          startedAt: -42 * SECOND,
          ...(running ? undefined : { endedAt: 0 }),
        },
      },
    ],
  },
];

test("a finished turn's last line says how long it worked and the day and time it ended, the day as a call's header says it", () => {
  const later = (days: number) => TURN_END + days * 24 * HOUR;
  assert.equal(
    workedForText(TURN_END - 78 * SECOND, TURN_END, TURN_END + HOUR, "en-US"),
    "Worked for 1m 18s · Today, 3:42 PM",
  );
  assert.equal(
    workedForText(TURN_END - 3 * HOUR, TURN_END, later(1), "en-US"),
    "Worked for 3h 0m · Yesterday, 3:42 PM",
  );
  assert.equal(
    workedForText(TURN_END - 42 * SECOND, TURN_END, later(10), "en-US"),
    "Worked for 42s · Oct 12, 3:42 PM",
  );
  assert.equal(
    workedForText(TURN_END - 42 * SECOND, TURN_END, later(100), "en-US"),
    "Worked for 42s · Oct 12, 2026, 3:42 PM",
  );
});

it.effect(
  "an agent's finished turn ends on how long it worked and when, selectable, its card on hover, and a turn still written ends on none",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(TURN_END + MINUTE);
      const tab = yield* mounted(
        createElement(AgentTranscriptView, {
          messages: [agentTurn(false)],
          reading: false,
          failed: false,
          working: true,
          onRetry: () => undefined,
        }),
      );
      assert.equal(tab.worked(), null);
      yield* tab.draw(
        createElement(AgentTranscriptView, {
          messages: [agentTurn(true)],
          reading: false,
          failed: false,
          working: false,
          onRetry: () => undefined,
        }),
      );
      const worked = tab.worked();
      assert.match(worked?.textContent ?? "", /^Worked for 1m 18s · Today, /u);
      assert.equal(worked?.closest("[data-worked]")?.classList.contains("select-text"), true);
      assert.equal(
        worked?.querySelector("time")?.getAttribute("datetime"),
        new Date(TURN_END).toISOString(),
      );
      assert.equal(
        tab.hoverWorked()?.querySelector(".turn-card-when")?.textContent,
        spanText(TURN_END - 78 * SECOND, TURN_END),
      );
      tab.unmount();
    }),
);

it.effect(
  "a turn's finished line is set as its working line was, in the same type and colour, without the shimmer",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(TURN_END + MINUTE);
      const view = (finished: boolean) =>
        createElement(AgentTranscriptView, {
          messages: [agentTurn(finished)],
          reading: false,
          failed: false,
          working: !finished,
          startedAt: TURN_END - 78 * SECOND,
          onRetry: () => undefined,
        });
      const tab = yield* mounted(view(false));
      const set = (line: Element | null | undefined) =>
        STATUS_LINE_CLASS.split(" ").filter((name) => line?.classList.contains(name) !== true);
      assert.deepEqual(set(tab.working()), [], "the working line is set in the status type");
      yield* tab.draw(view(true));
      const worked = tab.worked();
      assert.deepEqual(set(worked), [], "the finished line is set as the working line was");
      assert.equal(worked?.querySelector(".animate-shimmer"), null);
      tab.unmount();
    }),
);

it.effect(
  "hovering an agent's finished turn says the model and effort it ran on with its harness's mark, when it began and ended in full, and the tokens it spent",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(TURN_END + MINUTE);
      const tab = yield* mounted(finishedAgent(OPUS_TURN));
      const card = tab.hoverWorked();
      assert.equal(card?.querySelector(".turn-card-model")?.textContent, "Opus 5.5 High");
      assert.equal(
        card?.querySelector("[data-harness]")?.getAttribute("data-harness"),
        MODEL_PROVIDER.ANTHROPIC,
      );
      assert.equal(
        card?.querySelector(".turn-card-when")?.textContent,
        "Oct 12, 2026, 3:40 PM → 3:42 PM",
      );
      assert.equal(card?.querySelector(".turn-card-ending"), null);
      assert.deepEqual(tokenRows(card), [
        ["Input", "1,004"],
        ["Output", "660"],
        ["Cache read", "396,430"],
      ]);
      tab.unmount();
    }),
);

it.effect("the whole finished line hangs the card: its length and its timestamp alike", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(TURN_END + MINUTE);
    const opened: (string | undefined)[] = [];
    for (const part of ["[data-worked-length]", "[data-worked] time"]) {
      const tab = yield* mounted(finishedAgent(OPUS_TURN));
      opened.push(
        tab.hoverWorked(part)?.querySelector(".turn-card-model")?.textContent ?? undefined,
      );
      tab.unmount();
    }
    assert.deepEqual(opened, ["Opus 5.5 High", "Opus 5.5 High"]);
  }),
);

it.effect(
  "a turn whose provider said what it wrote to the cache lists it, out of the input row",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(TURN_END + MINUTE);
      const tokens = {
        inputTokens: 2_000,
        outputTokens: 50,
        cachedInputTokens: 1_200,
        cacheWriteTokens: 600,
      };
      const tab = yield* mounted(finishedAgent({ ...OPUS_TURN, tokens }));
      assert.deepEqual(tokenRows(tab.hoverWorked()), [
        ["Input", "200"],
        ["Output", "50"],
        ["Cache read", "1,200"],
        ["Cache write", "600"],
      ]);
      tab.unmount();
    }),
);

it.effect("a turn whose row counted no tokens hangs a card with no token section", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(TURN_END + MINUTE);
    const { tokens: _counted, ...uncounted } = OPUS_TURN;
    const tab = yield* mounted(finishedAgent(uncounted));
    const card = tab.hoverWorked();
    assert.equal(card?.querySelector(".turn-card-model")?.textContent, "Opus 5.5 High");
    assert.equal(card?.querySelector(".turn-card-tokens"), null);
    tab.unmount();
  }),
);

it.effect("a stopped, failed, or abandoned turn's card says how it ended", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(TURN_END + MINUTE);
    const endings: string[] = [];
    for (const ending of Object.values(TURN_ENDING)) {
      const tab = yield* mounted(finishedAgent({ ...OPUS_TURN, ending }));
      endings.push(tab.hoverWorked()?.querySelector(".turn-card-ending")?.textContent ?? "");
      tab.unmount();
    }
    assert.deepEqual(endings, ["Stopped", "Failed", "Abandoned"]);
  }),
);

it.effect(
  "hovering a finished turn on the Call tab says the model Luke ran on with its provider's mark, as an agent's turn does, and that it was stopped where it was",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(TURN_END + MINUTE);
      const work = yield* mounted(
        createElement(PlanCall, {
          region: NO_CALLS,
          onRetry: () => undefined,
          turns: [
            {
              turnId: "turn-1",
              startedAt: TURN_END - 42 * SECOND,
              endedAt: TURN_END,
              state: PLAN_WORK_STATE.FAILED,
              earlierOmitted: false,
              parts: [{ type: "text", text: "Reading the repository." }],
              model: "openai/gpt-6.1-sol",
              ending: TURN_ENDING.STOPPED,
            },
          ],
          callLive: false,
          earlier: undefined,
          onLoadEarlier: () => Promise.resolve(),
          onOpenSubagent: () => undefined,
          shown: true,
          models: [SOL],
        }),
      );
      const card = work.hoverWorked();
      assert.equal(card?.querySelector(".turn-card-model")?.textContent, "GPT-6.1 Sol");
      assert.ok(card?.querySelector(`[data-harness="${MODEL_PROVIDER.OPENAI}"] .provider-mark`));
      assert.equal(card?.querySelector(".turn-card-ending")?.textContent, "Stopped");
      assert.equal(card?.querySelector(".turn-card-tokens"), null);
      work.unmount();
    }),
);

it.effect(
  "a running worker's row counts from when the agent's page said it began, beside its spinner, and stops counting once its call answers",
  () =>
    Effect.gen(function* () {
      const view = (running: boolean) =>
        createElement(AgentTranscriptView, {
          messages: [delegatingTurn(running)],
          delegation: { models: [], starts: new Map([["call-worker", -42 * SECOND]]) },
          reading: false,
          failed: false,
          working: true,
          onRetry: () => undefined,
        });
      const tab = yield* mounted(view(true));
      assert.equal(tab.timer(), "42s");
      yield* advance(Duration.seconds(1));
      assert.equal(tab.timer(), "43s");
      yield* tab.draw(view(false));
      assert.equal(tab.timer(), null);
      tab.unmount();
    }),
);

it.effect(
  "the Call tab's running worker counts from its task's start while the tab is on screen, and a finished turn ends on how long it worked",
  () =>
    Effect.gen(function* () {
      const tab = (running: boolean, shown: boolean) =>
        createElement(PlanCall, {
          region: NO_CALLS,
          onRetry: () => undefined,
          turns: workerTurns(running),
          callLive: true,
          earlier: undefined,
          onLoadEarlier: () => Promise.resolve(),
          onOpenSubagent: () => undefined,
          shown,
        });
      const work = yield* mounted(tab(true, true));
      // The worker's count beside its spinner, then the turn's own on the working line it ends on.
      assert.deepEqual(work.timers(), ["42s", "1m 0s"]);
      assert.equal(work.worked(), null);
      yield* advance(Duration.seconds(1));
      assert.deepEqual(work.timers(), ["43s", "1m 1s"]);
      yield* work.draw(tab(true, false));
      assert.deepEqual(work.timers(), []);
      yield* work.draw(tab(false, true));
      assert.deepEqual(work.timers(), []);
      assert.match(work.worked()?.textContent ?? "", /^Worked for 1m 0s · /u);
      work.unmount();
    }),
);

it.effect(
  "a subagent's tab counts from its task's start while it runs, and once it answered ends on how long it worked",
  () =>
    Effect.gen(function* () {
      const tab = (running: boolean) => {
        const worker = workerOf(workRowsOf(workerTurns(running), true), "call-worker");
        assert.ok(worker);
        return createElement(SubagentTab, { worker, shown: true });
      };
      const session = yield* mounted(tab(true));
      assert.equal(session.timer(), "42s");
      assert.equal(session.worked(), null);
      yield* session.draw(tab(false));
      assert.equal(session.timer(), null);
      assert.match(session.worked()?.textContent ?? "", /^Worked for 42s · /u);
      session.unmount();
    }),
);
