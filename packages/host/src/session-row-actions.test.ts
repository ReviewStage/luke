import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_REFUSAL } from "@sidecar/actions";
import {
  PRODUCT_EVENT,
  PRODUCT_SESSION_ACTION,
  type ProductEvent,
  type ProductEventName,
} from "@sidecar/analytics";
import {
  HOSTED_ACTION_FAILURE,
  type HostedActionOutcome,
  type HostedActionTarget,
} from "@sidecar/hosted";
import {
  CLOUD_AGENT_PROVIDER_ID,
  normalizeSession,
  PROVIDER_ID,
  SESSION_STATUS,
  type Session,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { createSessionRowActions } from "./session-row-actions.js";

/*
 * A row's own send and press are admitted by the service against the stored
 * snapshot the row was drawn from, so what these tests hold the module to is
 * the two ends it owns: a session the drawn roster no longer holds is refused
 * without a call, and what the service answers reaches the row as the write
 * result it means, with the redraw and the count a landed write earns.
 */

const NOW = 1_800_000_000_000;

const CLOUD: Session = normalizeSession(
  { id: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, displayName: "Conductor" },
  {
    providerSessionId: "chat-1",
    title: "Fix the flaky test",
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
  },
);

const LOCAL: Session = normalizeSession(
  { id: PROVIDER_ID.CODEX, displayName: "Codex" },
  {
    providerSessionId: "local-1",
    title: "Write the release notes",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
  },
);

interface Recorded {
  readonly calls: { target: HostedActionTarget; ask: string }[];
  readonly events: { name: ProductEventName; properties: ProductEvent["properties"] }[];
  refreshes: number;
}

function fixture(outcome: HostedActionOutcome, drawn: readonly Session[] = [CLOUD, LOCAL]) {
  const recorded: Recorded = { calls: [], events: [], refreshes: 0 };
  const actions = createSessionRowActions({
    drawn: () => drawn,
    client: {
      async sendMessage(target, text) {
        recorded.calls.push({ target, ask: text });
        return outcome;
      },
      async executeControl(target, controlId) {
        recorded.calls.push({ target, ask: controlId });
        return outcome;
      },
    },
    refresh: async () => {
      recorded.refreshes += 1;
    },
    recordProductEvent: (name, properties) => {
      recorded.events.push({ name, properties });
    },
  });
  return { actions, recorded };
}

const identityOf = (session: Session) => ({
  providerId: session.providerId,
  providerSessionId: session.providerSessionId,
});

test("a session the drawn roster does not hold is refused without a call", async () => {
  const { actions, recorded } = fixture({ answer: { result: ACTION_RESULT_STATUS.ACCEPTED } });
  const result = await actions.sendMessage(
    { providerId: CLOUD.providerId, providerSessionId: "chat-nobody-drew" },
    "hello",
  );
  assert.deepEqual(result, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ACTION_REFUSAL.NO_SESSION,
  });
  assert.equal(recorded.calls.length, 0);
  assert.equal(recorded.refreshes, 0);
});

test("a session whose provider has no endpoint from this Mac is unsupported without a call", async () => {
  const { actions, recorded } = fixture({ answer: { result: ACTION_RESULT_STATUS.ACCEPTED } });
  const result = await actions.executeControl(identityOf(LOCAL), "cancel-run");
  assert.equal(result.status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(recorded.calls.length, 0);
});

test("an accepted write names the drawn session, redraws the rows, and is counted once", async () => {
  const { actions, recorded } = fixture({ answer: { result: ACTION_RESULT_STATUS.ACCEPTED } });

  assert.deepEqual(await actions.sendMessage(identityOf(CLOUD), "ship it"), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
  });
  assert.deepEqual(await actions.executeControl(identityOf(CLOUD), "cancel-run"), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
  });

  assert.deepEqual(recorded.calls, [
    { target: identityOf(CLOUD), ask: "ship it" },
    { target: identityOf(CLOUD), ask: "cancel-run" },
  ]);
  assert.equal(recorded.refreshes, 2);
  assert.deepEqual(recorded.events, [
    {
      name: PRODUCT_EVENT.SESSION_ACTION_SEND,
      properties: {
        provider_id: CLOUD.providerId,
        session_action: PRODUCT_SESSION_ACTION.MESSAGE_SEND,
      },
    },
    {
      name: PRODUCT_EVENT.SESSION_ACTION_SEND,
      properties: {
        provider_id: CLOUD.providerId,
        session_action: PRODUCT_SESSION_ACTION.CONTROL_RUN,
      },
    },
  ]);
});

test("the service's refusal reaches the row as written, redraws, and is not counted", async () => {
  const { actions, recorded } = fixture({
    answer: { result: ACTION_RESULT_STATUS.REJECTED, reason: "That run has ended." },
  });
  assert.deepEqual(await actions.executeControl(identityOf(CLOUD), "cancel-run"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: "That run has ended.",
  });
  assert.equal(recorded.refreshes, 1);
  assert.equal(recorded.events.length, 0);
});

test("a call that never left is a refusal, and one that lost its answer is unknown", async () => {
  const unsent = fixture({ failure: HOSTED_ACTION_FAILURE.NOT_SENT });
  assert.equal(
    (await unsent.actions.sendMessage(identityOf(CLOUD), "hello")).status,
    ACTION_RESULT_STATUS.REJECTED,
  );

  const refused = fixture({ failure: HOSTED_ACTION_FAILURE.REFUSED });
  assert.equal(
    (await refused.actions.sendMessage(identityOf(CLOUD), "hello")).status,
    ACTION_RESULT_STATUS.REJECTED,
  );

  const lost = fixture({ failure: HOSTED_ACTION_FAILURE.LOST });
  assert.equal(
    (await lost.actions.sendMessage(identityOf(CLOUD), "hello")).status,
    UNKNOWN_ACTION_STATUS,
  );

  const unreadable = fixture({ failure: HOSTED_ACTION_FAILURE.UNREADABLE });
  assert.equal(
    (await unreadable.actions.executeControl(identityOf(CLOUD), "cancel-run")).status,
    UNKNOWN_ACTION_STATUS,
  );
  assert.equal(unreadable.recorded.refreshes, 1);
  assert.equal(unreadable.recorded.events.length, 0);
});
