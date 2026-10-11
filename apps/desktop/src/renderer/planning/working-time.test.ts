// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { it } from "@effect/vitest";
import { PLAN_WORK_STATE, type PlanWorkState } from "@sidecar/hosted/planning-view";
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
import { PlanWork } from "./plan-work";
import { WorkingLine, workingClock, workingTime } from "./working-time";

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
      draw: (next: ReactElement) =>
        Effect.andThen(
          Effect.sync(() => draw(next)),
          drawn,
        ),
      unmount: () => act(() => root.unmount()),
    };
  });

/** An agent's transcript of one line of the developer's, working on the run given or ended. */
const transcript = (run: { working: boolean; startedAt?: number; ended?: string }) =>
  createElement(AgentTranscriptView, {
    messages: [{ id: "m1", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Plan" }] }],
    reading: false,
    failed: false,
    onRetry: () => undefined,
    openGitHub: () => undefined,
    copyText: () => Promise.resolve(),
    ...run,
  });

/** The Work tab holding one of Luke's turns, begun three minutes before the clock's zero, in the state given, on screen or not. */
const work = (state: PlanWorkState, shown: boolean) =>
  createElement(PlanWork, {
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

it.effect("a working line counts up from its run's start each second, across the minute", () =>
  Effect.gen(function* () {
    const line = yield* mounted(createElement(WorkingLine, { startedAt: -58 * SECOND }));
    assert.equal(line.text(), "Working…58s");
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
  "the Work tab's running turn counts from when it began while the tab is on screen, and a settled turn counts nothing",
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
