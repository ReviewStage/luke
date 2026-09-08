import assert from "node:assert/strict";
import test from "node:test";
import {
  GATEWAY_ATTACH_OUTCOME,
  GATEWAY_ATTACHMENT,
  type GatewayAttachment,
  type GatewayAttachResult,
} from "@sidecar/runtime";
import { attachAndSettle, followReattachments, retryAttachWhileFailed } from "./attachment";

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
      return { outcome: GATEWAY_ATTACH_OUTCOME.STARTED, pid: 7 } as GatewayAttachResult;
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

test("reattachments after the first each run the attachment work again", async () => {
  const s = supervisor();
  let runs = 0;
  followReattachments({
    onStateChanged: s.onStateChanged,
    onAttached: async () => {
      runs += 1;
    },
    report: () => undefined,
  });
  s.announce(GATEWAY_ATTACHMENT.ATTACHED);
  assert.equal(runs, 0);
  s.announce(GATEWAY_ATTACHMENT.DETACHED);
  s.announce(GATEWAY_ATTACHMENT.ATTACHED);
  s.announce(GATEWAY_ATTACHMENT.ATTACHED);
  await Promise.resolve();
  assert.equal(runs, 2);
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
