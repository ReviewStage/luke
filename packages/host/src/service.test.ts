import assert from "node:assert/strict";
import type { BrainAgent, BrainRequestRecord, BrainSubmission } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_METHOD,
  GatewayClient,
  InProcessTransport,
  NODE_CAPABILITY_STATUS,
} from "@sidecar/gateway";
import { TextLoopbackTransport } from "@sidecar/gateway/testing";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { isRecord, type WireRecord, type WireValue } from "@sidecar/wire";
import { test } from "vitest";
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion.js";
import type { ConversationOperations } from "./conversation-operations.js";
import { HOST_NATIVE_NODE_ID } from "./node-capabilities.js";
import { createGatewayOperator } from "./operator.js";
import { scopedGatewayService } from "./testing/gateway-service.js";

const NOW = 1_800_000_000_000;

/** A wire value the test expects to be a record; anything else fails the test where it stands. */
function recordOf(value: WireValue | undefined): WireRecord {
  assert.ok(isRecord(value));
  return value;
}

type RecordOverrides = { [K in keyof BrainRequestRecord]?: BrainRequestRecord[K] | undefined };

function record(overrides: RecordOverrides = {}): BrainRequestRecord {
  // Object.assign rather than a spread: spreading a Partial marks every key it
  // could carry optional, and the result stops being a BrainRequestRecord.
  return Object.assign<BrainRequestRecord, RecordOverrides>(
    {
      runId: "run-1",
      submissionId: "sub-1",
      origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
      question: "what needs me?",
      status: BRAIN_REQUEST_STATUS.RUNNING,
      revision: 1,
      acceptedAt: NOW,
      performedActions: 0,
      unknownActions: 0,
      askRecordedAt: NOW,
    },
    overrides,
  );
}

/**
 * A brain standing in for the wiring: one conversation, records the test
 * sets, submissions counted and answered with fresh runs, and a generation
 * the test can replace as a credential change would.
 */
async function fixture(transportKind: "in-process" | "loopback" = "in-process") {
  let ids = 0;
  let runs = 0;
  const records = new Map<string, BrainRequestRecord>();
  const asked: BrainSubmission[] = [];
  const generation = { id: "gen-1" };
  const deleted: SessionKey[] = [];
  // SAFETY: the service reads only these members off an agent; the fixture stands in for the rest.
  const agent = {
    submitAsk: async (submission: BrainSubmission) => {
      asked.push(submission);
      const runId = `run-${++runs}`;
      records.set(
        runId,
        record({
          runId,
          submissionId: submission.submissionId,
          question: submission.question,
          askRecordedAt: undefined,
        }),
      );
      return { outcome: "accepted", runId, acceptedAt: NOW };
    },
    request: (runId: string) => records.get(runId),
    waitAsk: async (runId: string) => records.get(runId),
    cancelAsk: async (runId: string) => {
      const held = records.get(runId);
      if (!held) return undefined;
      const cancelled = { ...held, status: BRAIN_REQUEST_STATUS.CANCELLED, settledAt: NOW + 1 };
      records.set(runId, cancelled);
      return cancelled;
    },
    markAskRecorded: async () => true,
  } as unknown as BrainAgent;
  let brainStands = true;
  const { service } = await scopedGatewayService({
    brain: {
      current: () => (brainStands ? agent : undefined),
      agentForRun: (runId) => (brainStands && records.has(runId) ? agent : undefined),
      allRequests: () => [...records.values()],
      generationId: () => generation.id,
      // SAFETY: no test here reaches a child; the fixture stands in for the service.
      children: {} as ChildRunService,
      // SAFETY: only the revision is read; the fixture stands in for the snapshot.
      configuration: () => ({ revision: 1 }) as unknown as ResolvedConfiguration,
      updateConfiguration: () => [],
    },
    // SAFETY: the tests reach the deletion alone; the fixture stands in for the other operations.
    conversations: {
      deleteConversation: async (sessionKey: SessionKey) => {
        deleted.push(sessionKey);
        return CONVERSATION_DELETE_OUTCOME.COMPLETE;
      },
      holds: () => true,
      lines: () => [],
      directory: () => [],
    } as unknown as ConversationOperations,
    memory: { status: () => ({}) },
    observedSessionCount: () => 0,
    now: () => NOW,
    createId: () => `id-${++ids}`,
  });
  const identity = { clientId: "operator", role: GATEWAY_CLIENT_ROLE.OPERATOR };
  const transport =
    transportKind === "in-process"
      ? new InProcessTransport(service.gateway, identity)
      : new TextLoopbackTransport(service.gateway, identity);
  const operator = createGatewayOperator({
    client: new GatewayClient({ transport, createId: () => `request-${++ids}` }),
  });
  const events: { kind: string; payload: WireValue }[] = [];
  service.gateway.log.listen((event) => events.push({ kind: event.kind, payload: event.payload }));
  return {
    service,
    operator,
    transport,
    records,
    asked,
    deleted,
    events,
    generation,
    retireBrain: () => {
      brainStands = false;
    },
    /** The followers' report of every record, as the wiring's broadcast hands it on. */
    report: () => service.runsReported([...records.values()]),
  };
}

for (const kind of ["in-process", "loopback"] as const) {
  test(`[${kind}] a duplicate submission finds the one run`, async () => {
    const f = await fixture(kind);
    const submission = {
      submissionId: "sub-1",
      question: "what needs me?",
      origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
    } as const;
    const first = await f.operator.submit(submission);
    const retry = await f.operator.submit(submission);
    assert.deepEqual(first, retry);
    assert.equal(f.asked.length, 1);
    // A submission of other words under the same id is a conflict the client reads as a refusal.
    const conflict = await f.operator.submit({ ...submission, question: "other words" });
    assert.equal(conflict.outcome, "rejected");
    assert.equal(f.asked.length, 1);
  });

  test(`[${kind}] the Clear crosses the boundary as Delete conversation on main and answers whether it landed`, async () => {
    const f = await fixture(kind);
    assert.equal(await f.operator.deleteConversation(MAIN_SESSION_KEY), true);
    assert.deepEqual(f.deleted, [MAIN_SESSION_KEY]);
  });

  test(`[${kind}] the run list and conversation changes reach the client as numbered events it can reconcile against`, async () => {
    const f = await fixture(kind);
    const runs: number[] = [];
    f.operator.onRunsChanged((list) => runs.push(list.length));
    const changes: string[] = [];
    f.operator.onConversationChanged((change) =>
      changes.push(`${change.sessionKey}:${change.entries.length}:${change.cleared}`),
    );
    await f.operator.submit({
      submissionId: "s",
      question: "q",
      origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
    });
    f.report();
    f.service.conversationChanged(
      MAIN_SESSION_KEY,
      [{ kind: CONVERSATION_ENTRY_KIND.ASK, words: "q" }],
      "window-7",
    );
    f.service.conversationChanged(MAIN_SESSION_KEY, []);
    assert.deepEqual(runs, [1]);
    assert.deepEqual(changes, ["agent:main:main:1:false", "agent:main:main:0:true"]);
    const listed = await f.operator.runs();
    assert.equal(listed.length, 1);
    assert.equal(f.operator.client.lastSequence(), 3);
  });

  test(`[${kind}] a node the host needs that is not connected answers unavailable through the protocol`, async () => {
    const f = await fixture(kind);
    const missing = await f.operator.client.call(GATEWAY_METHOD.NODE_INVOKE, {
      capability: "os.openExternal",
      params: { url: "https://example.test" },
    });
    assert.ok(missing.ok);
    assert.equal(recordOf(missing.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    const opened: string[] = [];
    f.service.nodes.register({
      nodeId: HOST_NATIVE_NODE_ID,
      capabilities: {
        "os.openExternal": (params) => {
          opened.push(String(params.url));
          return undefined;
        },
      },
    });
    const ok = await f.operator.client.call(GATEWAY_METHOD.NODE_INVOKE, {
      capability: "os.openExternal",
      params: { url: "https://example.test" },
    });
    assert.ok(ok.ok && recordOf(ok.result).status === NODE_CAPABILITY_STATUS.OK);
    assert.deepEqual(opened, ["https://example.test"]);
    // A registration over the wire binds the node to the connection it came
    // on: an ask of it is dispatched there and nowhere else, and a connection
    // that serves no handler answers unavailable, the ask never dispatched.
    const remote = await f.operator.client.call(GATEWAY_METHOD.NODE_REGISTER, {
      nodeId: "phone",
      capabilities: ["mic"],
    });
    assert.ok(remote.ok);
    const unserved = await f.operator.client.call(GATEWAY_METHOD.NODE_INVOKE, {
      capability: "mic",
      params: {},
    });
    assert.ok(unserved.ok);
    assert.equal(recordOf(unserved.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    assert.ok(f.service.nodes.list().some((node) => node.nodeId === "phone" && node.connected));
  });
}
