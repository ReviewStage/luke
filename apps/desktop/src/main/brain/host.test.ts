import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAgent } from "@sidecar/brain";
import { BrainHost } from "./host";

/** An agent whose stop the test releases, recording the order things happened in. */
function fakeAgent(name: string, log: string[]) {
  let release: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  // SAFETY: the host reads only `stop` off an agent; the fixture stands in for the rest.
  const agent = {
    stop: () => {
      log.push(`stop ${name}`);
      return stopped;
    },
  } as unknown as BrainAgent;
  return { agent, release: () => release?.() };
}

function host(log: string[]) {
  return new BrainHost({
    follow: (agent) => {
      log.push(`follow ${agent === undefined ? "none" : "agent"}`);
      return async () => {
        log.push("unfollow");
      };
    },
    publishEmpty: () => log.push("publish empty"),
  });
}

test("retiring withdraws the agent at once and begins its stop before any await", () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  void brains.replace(() => a.agent);
  a.release();
  return brains.settled().then(() => {
    assert.equal(brains.current(), a.agent);
    brains.retire();
    assert.equal(brains.current(), undefined);
    assert.deepEqual(log, ["follow agent", "stop a"]);
  });
});

test("overlapping transitions install only the latest agent, once every earlier stop has settled", async () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  const b = fakeAgent("b", log);
  const c = fakeAgent("c", log);
  await brains.replace(() => a.agent);
  assert.equal(brains.current(), a.agent);
  const installed = log.length;

  // Transition B retires A and waits on A's slow stop; transition C arrives
  // meanwhile. B must install nothing, and C must not install until A has
  // stopped.
  const second = brains.replace(() => {
    log.push("build b");
    return b.agent;
  });
  const third = brains.replace(() => {
    log.push("build c");
    return c.agent;
  });
  assert.equal(brains.current(), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!log.includes("build b") && !log.includes("build c"));
  a.release();
  await Promise.all([second, third]);
  assert.equal(brains.current(), c.agent);
  assert.deepEqual(
    log.slice(installed).filter((entry) => entry.startsWith("build") || entry.startsWith("follow")),
    ["build c", "follow agent"],
  );
  assert.equal(log.filter((entry) => entry === "stop b").length, 0);
});

test("a build decided after a newer transition is stopped rather than installed, and no capability publishes empty", async () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  let newer: Promise<void> | undefined;
  const older = brains.replace(() => {
    // The build itself asks for another transition — the same shape as a
    // capability changing while the previous build is deciding.
    newer = brains.replace(() => undefined);
    return a.agent;
  });
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
  await brains.replace(() => a.agent);
  const replacing = brains.replace(() => {
    log.push("build b");
    return b.agent;
  });
  // The source goes away before A has finished stopping: nothing may install.
  brains.retire();
  a.release();
  await replacing;
  assert.equal(brains.current(), undefined);
  assert.ok(!log.includes("build b"));
  // A later transition with no capability publishes the empty list once.
  await brains.replace(() => undefined);
  assert.equal(log.filter((entry) => entry === "publish empty").length, 1);
});

test("the follower outlives the stop it relays, and retires once the stop settles", async () => {
  const log: string[] = [];
  const brains = host(log);
  const a = fakeAgent("a", log);
  await brains.replace(() => a.agent);
  brains.retire();
  assert.deepEqual(log, ["follow agent", "stop a"]);
  a.release();
  await brains.replace(() => undefined);
  assert.deepEqual(log, ["follow agent", "stop a", "unfollow", "publish empty"]);
});

test("a build that throws fails its own transition, and the next transition still installs", async () => {
  const log: string[] = [];
  const brains = host(log);
  await assert.rejects(
    brains.replace(() => {
      throw new Error("client refused");
    }),
    /client refused/,
  );
  assert.equal(brains.current(), undefined);

  const b = fakeAgent("b", log);
  b.release();
  await brains.replace(() => b.agent);
  assert.equal(brains.current(), b.agent);

  let laterBuilds = 0;
  await brains.replace(() => {
    laterBuilds += 1;
    return undefined;
  });
  assert.equal(laterBuilds, 1);
  assert.equal(brains.current(), undefined);
  assert.deepEqual(log, ["follow agent", "stop b", "unfollow", "publish empty"]);
});

test("a rejected drain fails the transition that waited on it, after every other drain has ended, and the next transition still installs", async () => {
  const log: string[] = [];
  let releaseSlow: (() => void) | undefined;
  const slowUnfollow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  let followed = 0;
  const brains = new BrainHost({
    follow: () => {
      followed += 1;
      log.push(`follow ${followed}`);
      // The first follower's drain rejects; the second's is slow to settle.
      if (followed === 1) return () => Promise.reject(new Error("publication refused"));
      if (followed === 2)
        return async () => {
          await slowUnfollow;
          log.push("slow unfollow settled");
        };
      return async () => undefined;
    },
    publishEmpty: () => log.push("publish empty"),
  });
  const a = fakeAgent("a", log);
  a.release();
  await brains.replace(() => a.agent);
  const b = fakeAgent("b", log);
  b.release();
  // Retiring a queues its rejecting drain; the replacement that waits on it
  // fails as its caller's transition, and b is never installed.
  await assert.rejects(
    brains.replace(() => b.agent),
    /publication refused/,
  );
  assert.equal(brains.current(), undefined);
  assert.equal(log.includes("follow 2"), false);

  // The queue is not poisoned: the next transition installs.
  const c = fakeAgent("c", log);
  c.release();
  await brains.replace(() => c.agent);
  assert.equal(brains.current(), c.agent);

  // Its drain is slow. Queued beside a bare retirement whose drain rejects at
  // once, both end before the transition waiting on them decides — and it
  // decides against installing, saying why.
  brains.retire();
  const d = fakeAgent("d", log);
  d.release();
  let built = false;
  const replacement = brains.replace(() => {
    built = true;
    return d.agent;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(built, false, "the transition waited on the slow drain");
  releaseSlow?.();
  await replacement;
  assert.equal(built, true);
  assert.equal(brains.current(), d.agent);
  assert.ok(log.includes("slow unfollow settled"));
});

test("a rejecting drain and a slow drain queued together both end before the transition decides", async () => {
  const log: string[] = [];
  let releaseSlow: (() => void) | undefined;
  const slowStop = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  // SAFETY: the host reads only `stop` off an agent; the fixture stands in for the rest.
  const slow = {
    stop: () => {
      log.push("stop slow");
      return slowStop;
    },
  } as unknown as BrainAgent;
  let followed = 0;
  const brains = new BrainHost({
    follow: () => {
      followed += 1;
      return followed === 1
        ? () => Promise.reject(new Error("publication refused"))
        : async () => {
            log.push("unfollow slow");
          };
    },
    publishEmpty: () => log.push("publish empty"),
  });
  const a = fakeAgent("a", log);
  a.release();
  await brains.replace(() => a.agent);
  // a's rejecting drain is queued at retire time — with a handler already
  // attached, so nothing is unhandled while the slow stop below runs.
  brains.retire();
  await assert.rejects(
    brains.replace(() => slow),
    /publication refused/,
  );
  // The queue recovered; slow installs, then is retired with a stop that lingers.
  await brains.replace(() => slow);
  assert.equal(brains.current(), slow);
  brains.retire();
  let built = false;
  const replacement = brains.replace(() => {
    built = true;
    return undefined;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(built, false, "the successor waited on the slow stop");
  releaseSlow?.();
  await replacement;
  assert.equal(built, true);
  assert.deepEqual(log.slice(-3), ["stop slow", "unfollow slow", "publish empty"]);
  await brains.settled();
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
      follow: () => {
        followed += 1;
        return () => Promise.reject(new Error(`drain ${followed} refused`));
      },
      publishEmpty: () => log.push("publish empty"),
    });
    const a = fakeAgent("a", log);
    a.release();
    await brains.replace(() => a.agent);
    brains.retire();
    // A slow credential apply stands between the retire and the rebuild.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandled, 0);
    await assert.rejects(
      brains.replace(() => undefined),
      /drain 1 refused/,
    );
    await brains.replace(() => undefined);
    assert.deepEqual(log.slice(-1), ["publish empty"]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
