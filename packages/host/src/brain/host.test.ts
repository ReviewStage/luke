import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { type BrainAgent, detachOn } from "@sidecar/brain";
import { Context, Effect } from "effect";
import { test } from "vitest";
import { BrainHost } from "./host.js";

/** The transitions run under the same empty services the host detaches its drains under. */
const run = <Value>(effect: Effect.Effect<Value>): Promise<Value> => Effect.runPromise(effect);
const detach = detachOn(Context.empty());

/** An agent whose stop the test releases, recording the order things happened in. */
function fakeAgent(name: string, log: string[]) {
  let release: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  // SAFETY: the host reads only `stop` off an agent; the fixture stands in for the rest.
  const agent = {
    stop: () =>
      Effect.suspend(() => {
        log.push(`stop ${name}`);
        return Effect.promise(() => stopped);
      }),
  } as unknown as BrainAgent;
  return { agent, release: () => release?.() };
}

function host(log: string[]) {
  return new BrainHost({
    detach,
    follow: (agent) =>
      Effect.sync(() => {
        log.push(`follow ${agent === undefined ? "none" : "agent"}`);
        return Effect.sync(() => {
          log.push("unfollow");
        });
      }),
    publishEmpty: () => log.push("publish empty"),
  });
}

test("retiring withdraws the agent at once and begins its stop before any await", () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  void run(brains.replace(() => Effect.succeed(a.agent)));
  a.release();
  return run(brains.settled()).then(() => {
    assert.equal(brains.current(), a.agent);
    brains.retire();
    assert.equal(brains.current(), undefined);
    assert.deepEqual(log, ["follow agent", "stop a"]);
  });
});

it.effect(
  "overlapping transitions install only the latest agent, once every earlier stop has settled",
  () =>
    Effect.gen(function* () {
      const log: string[] = [];
      const brains = host(log);
      const a = fakeAgent("a", log);
      const b = fakeAgent("b", log);
      const c = fakeAgent("c", log);
      yield* brains.replace(() => Effect.succeed(a.agent));
      assert.equal(brains.current(), a.agent);

      // Transition B retires A and waits on A's slow stop; transition C arrives
      // meanwhile. B must install nothing, and C must not install until A has
      // stopped.
      const second = run(
        brains.replace(() =>
          Effect.sync(() => {
            log.push("build b");
            return b.agent;
          }),
        ),
      );
      const third = run(
        brains.replace(() =>
          Effect.sync(() => {
            log.push("build c");
            return c.agent;
          }),
        ),
      );
      assert.equal(brains.current(), undefined);
      // A fixed, small number of fiber yields: enough for B's already-queued
      // step to start and suspend on A's still-unreleased stop, and no more,
      // since this is checking that neither builder has run yet.
      for (let tick = 0; tick < 10; tick += 1) yield* Effect.yieldNow;
      assert.ok(!log.includes("build b") && !log.includes("build c"));
      a.release();
      yield* Effect.promise(() => Promise.all([second, third]));
      assert.equal(brains.current(), c.agent);
      assert.equal(log.filter((entry) => entry === "stop b").length, 0);
    }),
);

test("a build decided after a newer transition is stopped rather than installed, and no capability publishes empty", async () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  let newer: Promise<void> | undefined;
  const older = run(
    brains.replace(() =>
      Effect.sync(() => {
        // The build itself asks for another transition — the same shape as a
        // capability changing while the previous build is deciding.
        newer = run(brains.replace(() => Effect.succeed(undefined)));
        return a.agent;
      }),
    ),
  );
  a.release();
  await older;
  await newer;
  assert.equal(brains.current(), undefined);
  assert.ok(log.includes("stop a"));
  assert.ok(!log.includes("follow agent"));
  assert.equal(log.filter((entry) => entry === "publish empty").length, 1);
});

test("a retirement while an earlier replacement waits on a stop leaves that build uninstalled", async () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  const b = fakeAgent("b", log);
  await run(brains.replace(() => Effect.succeed(a.agent)));
  const replacing = run(
    brains.replace(() =>
      Effect.sync(() => {
        log.push("build b");
        return b.agent;
      }),
    ),
  );
  // The source goes away before A has finished stopping: nothing may install.
  brains.retire();
  a.release();
  await replacing;
  assert.equal(brains.current(), undefined);
  assert.ok(!log.includes("build b"));
  // A later transition with no capability publishes the empty list once.
  await run(brains.replace(() => Effect.succeed(undefined)));
  assert.equal(log.filter((entry) => entry === "publish empty").length, 1);
});

test("the follower outlives the stop it relays, and retires once the stop settles", async () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  await run(brains.replace(() => Effect.succeed(a.agent)));
  brains.retire();
  assert.deepEqual(log, ["follow agent", "stop a"]);
  a.release();
  await run(brains.replace(() => Effect.succeed(undefined)));
  assert.deepEqual(log, ["follow agent", "stop a", "unfollow", "publish empty"]);
});

test("a build that throws fails its own transition, and the next transition still installs", async () => {
  const log: string[] = [];
  const brains = host(log);
  await assert.rejects(
    run(
      brains.replace(() =>
        Effect.sync((): BrainAgent | undefined => {
          throw new Error("client refused");
        }),
      ),
    ),
    /client refused/,
  );
  assert.equal(brains.current(), undefined);

  const b = fakeAgent("b", log);
  b.release();
  await run(brains.replace(() => Effect.succeed(b.agent)));
  assert.equal(brains.current(), b.agent);

  let laterBuilds = 0;
  await run(
    brains.replace(() =>
      Effect.sync(() => {
        laterBuilds += 1;
        return undefined;
      }),
    ),
  );
  assert.equal(laterBuilds, 1);
  assert.equal(brains.current(), undefined);
  assert.deepEqual(log, ["follow agent", "stop b", "unfollow", "publish empty"]);
});

test("a rejected drain fails the transition that waited on it, and the next transition still installs", async () => {
  const log: string[] = [];
  let followed = 0;
  const brains = new BrainHost({
    detach,
    follow: () =>
      Effect.sync(() => {
        followed += 1;
        log.push(`follow ${followed}`);
        return followed === 1
          ? Effect.die(new Error("publication refused"))
          : Effect.sync(() => {
              log.push("unfollow");
            });
      }),
    publishEmpty: () => log.push("publish empty"),
  });
  const a = fakeAgent("a", log);
  a.release();
  await run(brains.replace(() => Effect.succeed(a.agent)));
  const b = fakeAgent("b", log);
  b.release();
  // Retiring a queues its rejecting drain; the replacement that waits on it
  // fails as its caller's transition, and b is never installed.
  await assert.rejects(run(brains.replace(() => Effect.succeed(b.agent))), /publication refused/);
  assert.equal(brains.current(), undefined);
  assert.equal(log.includes("follow 2"), false);

  // The queue is not poisoned: the next transition installs, and the one
  // after it retires that agent and publishes empty.
  const c = fakeAgent("c", log);
  c.release();
  await run(brains.replace(() => Effect.succeed(c.agent)));
  assert.equal(brains.current(), c.agent);
  await run(brains.replace(() => Effect.succeed(undefined)));
  assert.deepEqual(log.slice(-3), ["stop c", "unfollow", "publish empty"]);
});

test("a superseded build's rejecting stop fails the older transition, and the newer one still installs", async () => {
  const log: string[] = [];
  const brains = host(log);
  let releaseFirstStop: (() => void) | undefined;
  const firstStop = new Promise<void>((resolve) => {
    releaseFirstStop = resolve;
  });
  // SAFETY: the host reads only `stop` off an agent; the fixture stands in for the rest.
  const first = {
    stop: () =>
      Effect.suspend(() => {
        log.push("stop first");
        return Effect.promise(() => firstStop);
      }),
  } as unknown as BrainAgent;
  // SAFETY: as above; this one's stop fails.
  const stale = {
    stop: () =>
      Effect.suspend(() => {
        log.push("stop stale");
        return Effect.die(new Error("stale stop refused"));
      }),
  } as unknown as BrainAgent;
  await run(brains.replace(() => Effect.succeed(first)));
  const later = fakeAgent("later", log);
  later.release();
  // The older transition's build is decided while first's stop is still out;
  // by then the newer transition has been asked for, so the stale agent is
  // stopped rather than installed, and its refusal is the older caller's.
  let newer: Promise<void> | undefined;
  const older = run(
    brains.replace(() =>
      Effect.sync(() => {
        newer = run(brains.replace(() => Effect.succeed(later.agent)));
        return stale;
      }),
    ),
  );
  releaseFirstStop?.();
  await assert.rejects(older, /stale stop refused/);
  assert.ok(newer);
  await newer;
  assert.equal(brains.current(), later.agent);
  assert.deepEqual(log, ["follow agent", "stop first", "unfollow", "stop stale", "follow agent"]);
});

test("a retirement queued alone has its rejection handled before any transition waits on it", async () => {
  const log: string[] = [];
  let unhandled = 0;
  const onUnhandled = () => {
    unhandled += 1;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    let followed = 0;
    const brains = new BrainHost({
      detach,
      follow: () =>
        Effect.sync(() => {
          followed += 1;
          return Effect.die(new Error(`drain ${followed} refused`));
        }),
      publishEmpty: () => log.push("publish empty"),
    });
    const a = fakeAgent("a", log);
    a.release();
    await run(brains.replace(() => Effect.succeed(a.agent)));
    brains.retire();
    // A slow credential apply stands between the retire and the rebuild.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandled, 0);
    await assert.rejects(run(brains.replace(() => Effect.succeed(undefined))), /drain 1 refused/);
    await run(brains.replace(() => Effect.succeed(undefined)));
    assert.deepEqual(log.slice(-1), ["publish empty"]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
