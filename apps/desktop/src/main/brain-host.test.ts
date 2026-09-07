import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAgent } from "@sidecar/brain";
import { BrainHost } from "./brain-host";

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
      return () => log.push("unfollow");
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
