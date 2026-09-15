import assert from "node:assert/strict";
import type { MemoryDefinition, MemoryScopeContext, MemoryTurnStartedContext } from "eve/memory";
import { test } from "vitest";
import notebook from "../eve/memory/notebook";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_PRINCIPAL_TYPE,
} from "../server/hosted/brain-host/bounds";

/**
 * What the eve memory slot is declared as, held to the decisions the host
 * carries: the flush runs from eve's `compaction.requested` capture and from
 * nothing else — no capture after a turn, no recall into a turn, no tool of
 * the slot's offered to the model — so when the flush fires is eve's own
 * compaction threshold and the slot adds no reading of the context to a
 * turn. Its scope is the account a session acts for, the deployment's named
 * account included, and nothing for a session with no account.
 */

function scopeContext(
  current: MemoryScopeContext["session"]["auth"]["current"],
): MemoryScopeContext {
  return {
    abortSignal: new AbortController().signal,
    session: { id: "wrun_test", auth: { current, initiator: current } },
    channel: {},
  };
}

/** The slot behind eve's own contract, so what it leaves undeclared reads as undefined rather than as a type error. */
const slot: MemoryDefinition = notebook;

test("the slot captures on compaction.requested alone, recalls nothing, and offers no tool", async () => {
  const provider = slot.provider;
  assert.deepEqual(Object.keys(provider.capture ?? {}), ["compaction.requested"]);
  assert.equal(provider.capture?.["turn.completed"], undefined);
  assert.equal(provider.recall["compaction.completed"], undefined);
  assert.equal(provider.tools, undefined);
  assert.equal(slot.description, undefined);
  assert.equal(slot.visibility, undefined);
  assert.equal(slot.namespace, undefined);
  // SAFETY: the recall reads nothing of its context; an empty record stands for it.
  const recalled = await provider.recall["turn.started"]({} as MemoryTurnStartedContext);
  assert.equal(recalled, null);
});

test("the slot's scope is the account the session acts for: the bearer's own, or the deployment's named account, and nothing otherwise", async () => {
  const scope = slot.scope;
  if (!(scope instanceof Function))
    throw new Error("the slot's scope is a resolver, not a fixed value");
  assert.equal(
    await scope(
      scopeContext({
        principalId: "user-1",
        principalType: BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
        authenticator: BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
        attributes: {},
      }),
    ),
    "user-1",
  );
  assert.equal(
    await scope(
      scopeContext({
        principalId: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
        principalType: BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT,
        authenticator: BRAIN_HOST_AUTHENTICATOR.DEPLOYMENT,
        attributes: { [BRAIN_HOST_ATTRIBUTE.ACCOUNT]: "user-2" },
      }),
    ),
    "user-2",
  );
  assert.equal(await scope(scopeContext(null)), null);
});
