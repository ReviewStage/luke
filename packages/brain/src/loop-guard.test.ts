import assert from "node:assert/strict";
import test from "node:test";
import type { ToolInvocation } from "@sidecar/runtime-contracts";
import type { WireRecord } from "@sidecar/wire";
import {
  hashToolCall,
  LOOP_GUARD_DETECTOR,
  LOOP_GUARD_LEVEL,
  LOOP_GUARD_THRESHOLDS,
  LoopGuard,
  stableStringify,
} from "./loop-guard.js";

function call(name: string, args: WireRecord, callId = "c"): ToolInvocation {
  return { callId, name, argumentsJson: JSON.stringify(args) };
}

function repeat(guard: LoopGuard, invocation: ToolInvocation, times: number, outputJson: string) {
  let last: ReturnType<LoopGuard["detect"]> = { stuck: false };
  for (let index = 0; index < times; index += 1) {
    last = guard.detect(invocation);
    guard.record(invocation, { outputJson });
  }
  return last;
}

test("the guard is off unless enabled, exactly as the pinned source has it", () => {
  const guard = new LoopGuard(undefined, ["poll"]);
  assert.equal(guard.enabled, false);
  assert.deepEqual(repeat(guard, call("poll", {}), 100, '{"same":1}'), { stuck: false });
});

test("hashes are stable across key order and equal arguments", () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  assert.equal(hashToolCall("t", '{"b":1,"a":2}'), hashToolCall("t", '{"a":2,"b":1}'));
});

test("identical calls warn at 10, go critical at 20 with identical outcomes, and trip the breaker at 30", () => {
  const guard = new LoopGuard({ enabled: true }, ["poll"]);
  const poll = call("poll", { id: 1 });
  const { WARNING, CRITICAL, GLOBAL_CIRCUIT_BREAKER } = LOOP_GUARD_THRESHOLDS;
  assert.deepEqual(repeat(guard, poll, WARNING, '{"status":"running"}'), { stuck: false });
  const warning = guard.detect(poll);
  assert.ok(warning.stuck && warning.level === LOOP_GUARD_LEVEL.WARNING);
  assert.equal(warning.detector, LOOP_GUARD_DETECTOR.GENERIC_REPEAT);
  repeat(guard, poll, CRITICAL - WARNING, '{"status":"running"}');
  const critical = guard.detect(poll);
  assert.ok(critical.stuck && critical.level === LOOP_GUARD_LEVEL.CRITICAL);
  assert.equal(critical.detector, LOOP_GUARD_DETECTOR.GENERIC_REPEAT);
  repeat(guard, poll, GLOBAL_CIRCUIT_BREAKER - CRITICAL, '{"status":"running"}');
  const breaker = guard.detect(poll);
  assert.ok(breaker.stuck);
  assert.equal(breaker.detector, LOOP_GUARD_DETECTOR.GLOBAL_CIRCUIT_BREAKER);
});

test("a changing outcome is progress: no-progress streaks reset, only the raw repeat warning stands", () => {
  const guard = new LoopGuard({ enabled: true }, ["poll"]);
  const poll = call("poll", {});
  for (let index = 0; index < LOOP_GUARD_THRESHOLDS.CRITICAL + 5; index += 1) {
    guard.detect(poll);
    guard.record(poll, { outputJson: JSON.stringify({ progress: index }) });
  }
  const verdict = guard.detect(poll);
  assert.ok(verdict.stuck && verdict.level === LOOP_GUARD_LEVEL.WARNING);
});

test("alternating between two signatures warns at 10 and goes critical at 20 with no progress", () => {
  const guard = new LoopGuard({ enabled: true }, ["a", "b"]);
  const first = call("a", { x: 1 });
  const second = call("b", { y: 2 });
  let verdict: ReturnType<LoopGuard["detect"]> = { stuck: false };
  for (let index = 0; index < LOOP_GUARD_THRESHOLDS.CRITICAL; index += 1) {
    const invocation = index % 2 === 0 ? first : second;
    verdict = guard.detect(invocation);
    if (index === LOOP_GUARD_THRESHOLDS.WARNING) {
      assert.ok(verdict.stuck && verdict.detector === LOOP_GUARD_DETECTOR.PING_PONG);
      assert.equal(verdict.level, LOOP_GUARD_LEVEL.WARNING);
    }
    guard.record(invocation, { outputJson: '{"same":true}' });
  }
  verdict = guard.detect(first);
  assert.ok(verdict.stuck && verdict.detector === LOOP_GUARD_DETECTOR.PING_PONG);
  assert.equal(verdict.level, LOOP_GUARD_LEVEL.CRITICAL);
});

test("a tool the run was never offered, asked for 10 times, is critical", () => {
  const guard = new LoopGuard({ enabled: true }, ["known"]);
  const missing = call("missing", {});
  repeat(guard, missing, LOOP_GUARD_THRESHOLDS.UNKNOWN_TOOL, '{"status":"rejected"}');
  const verdict = guard.detect(missing);
  assert.ok(verdict.stuck && verdict.detector === LOOP_GUARD_DETECTOR.UNKNOWN_TOOL_REPEAT);
  assert.equal(verdict.level, LOOP_GUARD_LEVEL.CRITICAL);
});

test("an unrelated call between identical no-progress calls does not hide the loop: 20 identical outcomes with one intervening call are critical", () => {
  const guard = new LoopGuard({ enabled: true }, ["a", "b"]);
  const stuck = call("a", { id: 1 });
  const other = call("b", {});
  for (let index = 0; index < LOOP_GUARD_THRESHOLDS.CRITICAL; index += 1) {
    if (index === 15) {
      guard.detect(other);
      guard.record(other, { outputJson: '{"fresh":true}' });
    }
    guard.detect(stuck);
    guard.record(stuck, { outputJson: '{"status":"running"}' });
  }
  const verdict = guard.detect(stuck);
  assert.ok(verdict.stuck);
  assert.equal(verdict.level, LOOP_GUARD_LEVEL.CRITICAL);
  assert.equal(verdict.detector, LOOP_GUARD_DETECTOR.GENERIC_REPEAT);
  assert.equal(verdict.count, LOOP_GUARD_THRESHOLDS.CRITICAL);
});

test("cycling through a few argument patterns onto one stable outcome is argument churn, warning-only", () => {
  const guard = new LoopGuard({ enabled: true }, ["search"]);
  const variants = [
    call("search", { q: "a" }),
    call("search", { q: "b" }),
    call("search", { q: "c" }),
  ];
  // The first call of each pattern has nothing to compare with, so it is not
  // yet no-progress; the warning needs ten no-progress calls behind it.
  for (let round = 0; round < 5; round += 1) {
    for (const variant of variants) {
      guard.detect(variant);
      guard.record(variant, { outputJson: '{"results":[]}' });
    }
  }
  const verdict = guard.detect(variants[0] ?? call("search", {}));
  assert.ok(verdict.stuck);
  assert.equal(verdict.detector, LOOP_GUARD_DETECTOR.ARGUMENT_CHURN);
  assert.equal(verdict.level, LOOP_GUARD_LEVEL.WARNING);
  // A novel argument resets the evidence rather than inheriting it.
  const novel = call("search", { q: "z" });
  guard.detect(novel);
  guard.record(novel, { outputJson: '{"results":[]}' });
  const after = guard.detect(call("search", { q: "y" }));
  assert.deepEqual(after, { stuck: false });
});
