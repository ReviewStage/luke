import assert from "node:assert/strict";
import test from "node:test";
import {
  GATEWAY_ATTACH_OUTCOME,
  GATEWAY_ATTACHMENT,
  type GatewayAttachment,
  type GatewayAttachResult,
} from "@sidecar/runtime";
import {
  attachAndSettle,
  followReattachments,
  retryAttachWhileFailed,
  waitForHost,
} from "./attachment";

/** A supervisor stand-in: announces ATTACHED before its attach resolves, as the real one does. */
function supervisor() {
  const listeners = new Set<(state: GatewayAttachment) => void>();
  return {
    onStateChanged: (listener: (state: GatewayAttachment) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    announce: (state: GatewayAttachment) => {
      for (const listener of [...listeners]) listener(state);
    },
  };
}

test("the launch waits for the first attachment's work, which the supervisor announces before attach resolves", async () => {
  const s = supervisor();
  const order: string[] = [];
  let releaseBootstrap: (() => void) | undefined;
  const bootstrap = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  const settling = attachAndSettle({
    onStateChanged: s.onStateChanged,
    attach: async () => {
      s.announce(GATEWAY_ATTACHMENT.ATTACHING);
      s.announce(GATEWAY_ATTACHMENT.ATTACHED);
      order.push("attach resolved");
      const result: GatewayAttachResult = { outcome: GATEWAY_ATTACH_OUTCOME.STARTED, pid: 7 };
      return result;
    },
    onAttached: async () => {
      order.push("attachment work began");
      await bootstrap;
      order.push("bootstrap adopted");
    },
    report: () => undefined,
  });
  let settled = false;
  void settling.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  // attach() has resolved, but the launch has not: the account it will read is not in yet.
  assert.deepEqual(order, ["attachment work began", "attach resolved"]);
  assert.equal(settled, false);
  releaseBootstrap?.();
  const first = await settling;
  assert.equal(first.reached, true);
  assert.deepEqual(order, ["attachment work began", "attach resolved", "bootstrap adopted"]);
});

test("a failed attach reaches no host and waits on nothing", async () => {
  const s = supervisor();
  const first = await attachAndSettle({
    onStateChanged: s.onStateChanged,
    attach: async () => ({ outcome: GATEWAY_ATTACH_OUTCOME.FAILED, failure: "unreachable" }),
    onAttached: async () => assert.fail("no attachment work runs for a failed attach"),
    report: () => undefined,
  });
  assert.equal(first.reached, false);
});

test("installed after the launch's attachment settled, the follower runs the attachment work on the very first reattachment", async () => {
  const s = supervisor();
  let runs = 0;
  const onAttached = async () => {
    runs += 1;
  };
  // Production order: the launch attaches and settles first, then follows.
  const first = await attachAndSettle({
    onStateChanged: s.onStateChanged,
    attach: async () => {
      s.announce(GATEWAY_ATTACHMENT.ATTACHED);
      return { outcome: GATEWAY_ATTACH_OUTCOME.STARTED, pid: 1 };
    },
    onAttached,
    report: () => undefined,
  });
  assert.equal(first.reached, true);
  assert.equal(runs, 1);
  followReattachments({ onStateChanged: s.onStateChanged, onAttached, report: () => undefined });
  // The Gateway dies and is found again: the supervisor announces the change only.
  s.announce(GATEWAY_ATTACHMENT.DETACHED);
  s.announce(GATEWAY_ATTACHMENT.ATTACHED);
  await Promise.resolve();
  assert.equal(runs, 2);
  s.announce(GATEWAY_ATTACHMENT.DETACHED);
  s.announce(GATEWAY_ATTACHMENT.ATTACHED);
  await Promise.resolve();
  assert.equal(runs, 3);
});

test("a failed attach is tried again after a growing pause until one attaches, and never after a stop", async () => {
  const s = supervisor();
  const scheduled: Array<{ work: () => void; delayMs: number }> = [];
  let attaches = 0;
  const stop = retryAttachWhileFailed({
    onStateChanged: s.onStateChanged,
    // The first attach already failed before the retries began: they begin at once.
    currentState: () => GATEWAY_ATTACHMENT.FAILED,
    attach: async () => {
      attaches += 1;
      return { outcome: GATEWAY_ATTACH_OUTCOME.FAILED, failure: "not_ready" };
    },
    setTimeout: (work, delayMs) => {
      scheduled.push({ work, delayMs });
      return undefined;
    },
    initialDelayMs: 100,
    maximumDelayMs: 250,
    report: () => undefined,
  });
  assert.deepEqual(
    scheduled.map((entry) => entry.delayMs),
    [100],
  );
  s.announce(GATEWAY_ATTACHMENT.FAILED);
  assert.deepEqual(
    scheduled.map((entry) => entry.delayMs),
    [100],
  );
  scheduled[0]?.work();
  assert.equal(attaches, 1);
  s.announce(GATEWAY_ATTACHMENT.FAILED);
  s.announce(GATEWAY_ATTACHMENT.FAILED);
  assert.deepEqual(
    scheduled.map((entry) => entry.delayMs),
    [100, 200],
  );
  scheduled[1]?.work();
  s.announce(GATEWAY_ATTACHMENT.FAILED);
  assert.deepEqual(
    scheduled.map((entry) => entry.delayMs),
    [100, 200, 250],
  );
  // An attachment resets the pause; a stop ends the retries.
  s.announce(GATEWAY_ATTACHMENT.ATTACHED);
  scheduled[2]?.work();
  s.announce(GATEWAY_ATTACHMENT.FAILED);
  assert.equal(scheduled.at(-1)?.delayMs, 100);
  s.announce(GATEWAY_ATTACHMENT.STOPPED);
  const before = attaches;
  scheduled.at(-1)?.work();
  assert.equal(attaches, before);
  stop();
});

test("attachment work that fails is a host not reached, even though a connection stood", async () => {
  const s = supervisor();
  const first = await attachAndSettle({
    onStateChanged: s.onStateChanged,
    attach: async () => {
      s.announce(GATEWAY_ATTACHMENT.ATTACHED);
      return { outcome: GATEWAY_ATTACH_OUTCOME.STARTED, pid: 7 };
    },
    onAttached: async () => {
      throw new Error("the bootstrap did not answer");
    },
    report: () => undefined,
  });
  assert.equal(first.reached, false);
});

test("a launch whose first attach failed waits for the retry that attaches and bootstraps, and runs its tail once", async () => {
  const s = supervisor();
  let attaches = 0;
  let bootstraps = 0;
  const reached = waitForHost({
    onStateChanged: s.onStateChanged,
    attach: async () => {
      attaches += 1;
      if (attaches === 1) {
        s.announce(GATEWAY_ATTACHMENT.FAILED);
        return { outcome: GATEWAY_ATTACH_OUTCOME.FAILED, failure: "not_ready" };
      }
      s.announce(GATEWAY_ATTACHMENT.ATTACHED);
      return { outcome: GATEWAY_ATTACH_OUTCOME.STARTED, pid: 9 };
    },
    onAttached: async () => {
      bootstraps += 1;
    },
    report: () => undefined,
  });
  let tailRan = 0;
  const launch = reached.then(() => {
    tailRan += 1;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(tailRan, 0);
  // The retry (driven by retryAttachWhileFailed in the app) attaches.
  const scheduled: Array<() => void> = [];
  retryAttachWhileFailed({
    onStateChanged: s.onStateChanged,
    currentState: () => GATEWAY_ATTACHMENT.FAILED,
    attach: async () => {
      attaches += 1;
      s.announce(GATEWAY_ATTACHMENT.ATTACHED);
      return { outcome: GATEWAY_ATTACH_OUTCOME.STARTED, pid: 9 };
    },
    setTimeout: (work) => {
      scheduled.push(work);
      return undefined;
    },
    report: () => undefined,
  });
  scheduled[0]?.();
  await launch;
  assert.equal(tailRan, 1);
  assert.equal(bootstraps, 1);
  // A later reattachment runs the attachment work again but never the tail.
  s.announce(GATEWAY_ATTACHMENT.ATTACHED);
  await Promise.resolve();
  assert.equal(tailRan, 1);
});
