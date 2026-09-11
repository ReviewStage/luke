import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { BrainAgent, BrainRequestRecord, BrainSubmission } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_METHOD,
  GATEWAY_SHUTDOWN_DEFAULTS,
  GatewayClient,
  NODE_CAPABILITY_STATUS,
  shutdownGateway,
} from "@sidecar/gateway";
import { gatewayMethodEffects } from "@sidecar/gateway/server";
import {
  bearerAuthentication,
  connectWebSocketGateway,
  GatewaySocketBinding,
  layerGatewaySocket,
  WEB_SOCKET_GATEWAY_DEFAULTS,
} from "@sidecar/gateway/websocket";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { isRecord, type WireValue } from "@sidecar/wire";
import { Context, Effect, Layer, Runtime, type Scope } from "effect";
import { test } from "vitest";
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion.js";
import type { ConversationOperations } from "./conversation-operations.js";
import { HOST_NATIVE_NODE_ID, HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { createGatewayService } from "./service.js";

/**
 * The ownership the client and host boundary claims, exercised over a real
 * socket: the host holds the asks and the Conversation; a client
 * that dies takes none of it with it; the next client finds it all; the
 * host's native asks answer typed unavailable while no client stands; and
 * the explicit shutdown counts what the durable records still hold.
 */
const NOW = 1_800_000_000_000;
const TOKEN = "a-shared-secret";

function record(overrides: Partial<BrainRequestRecord> = {}): BrainRequestRecord {
  return {
    runId: "run-1",
    submissionId: "sub-1",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
    question: "what needs me?",
    status: BRAIN_REQUEST_STATUS.RUNNING,
    revision: 1,
    acceptedAt: NOW,
    performedActions: 0,
    unknownActions: 0,
    ...overrides,
  };
}

/**
 * A host over a fake brain whose records are "persisted" into a separate
 * store the way the ledger persists them: a cancellation that fails to
 * persist leaves the persisted record running, which is what a launch finds.
 */
function fakeHost(options: { persistCancellations?: boolean } = {}) {
  let ids = 0;
  let runs = 0;
  const live = new Map<string, BrainRequestRecord>();
  const persisted = new Map<string, BrainRequestRecord>();
  const lines: ConversationEntry[] = [];
  // SAFETY: the service reads only these members off an agent; the fixture stands in for the rest.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- A fake agent is stood up whole for the host under test.
  const agent = {
    submitAsk: async (submission: BrainSubmission) => {
      const runId = `run-${++runs}`;
      const held = record({
        runId,
        submissionId: submission.submissionId,
        question: submission.question,
      });
      live.set(runId, held);
      persisted.set(runId, held);
      return { outcome: "accepted", runId, acceptedAt: NOW };
    },
    request: (runId: string) => live.get(runId),
    waitAsk: async (runId: string) => live.get(runId),
    cancelAsk: async (runId: string) => {
      const held = live.get(runId);
      if (!held) return undefined;
      const cancelled = { ...held, status: BRAIN_REQUEST_STATUS.CANCELLED, settledAt: NOW + 1 };
      live.set(runId, cancelled);
      if (options.persistCancellations !== false) persisted.set(runId, cancelled);
      return cancelled;
    },
    markAskRecorded: async () => true,
  } as unknown as BrainAgent;
  const service = createGatewayService({
    brain: {
      current: () => agent,
      agentForRun: (runId) => (live.has(runId) ? agent : undefined),
      allRequests: () => [...live.values()],
      generationId: () => "gen-1",
      // SAFETY: no test here reaches a child; the fixture stands in for the service.
      children: {} as ChildRunService,
      // SAFETY: only the revision is read; the fixture stands in for the snapshot.
      configuration: () => ({ revision: 1 }) as unknown as ResolvedConfiguration,
      updateConfiguration: () => [],
    },
    // SAFETY: the tests reach Conversation and the deletion alone; the fixture stands in for the rest.
    conversations: {
      deleteConversation: async () => CONVERSATION_DELETE_OUTCOME.COMPLETE,
      holds: () => true,
      lines: () => lines,
      directory: () => [],
    } as unknown as ConversationOperations,
    memory: { status: () => ({}) },
    observedSessionCount: () => 0,
    now: () => NOW,
    createId: () => `id-${++ids}`,
  });
  return { service, live, persisted, lines, agent };
}

/** One host's own methods on a real socket, bound for as long as the test's scope stands. */
interface Listening {
  readonly port: number;
  /** The shutdown's own press, as the report's options take it: a callback, run on this test's runtime. */
  readonly closeAdmissions: () => void;
}

/**
 * The host's own methods on a real socket. The binding provides the
 * `Protocol` a server is built over rather than attaching to one already
 * built, so it composes a server of its own over the service's own options:
 * the same methods, the same readers, and the same node registry the service
 * holds.
 */
const listen = (
  service: ReturnType<typeof fakeHost>["service"],
): Effect.Effect<Listening, never, Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      layerGatewaySocket({
        ...service.serverOptions,
        methods: gatewayMethodEffects(service.serverOptions.methods),
        authenticate: bearerAuthentication(TOKEN),
      }),
    ).pipe(Effect.orDie);
    const binding = Context.get(context, GatewaySocketBinding);
    const runSync = Runtime.runSync(yield* Effect.runtime<never>());
    return {
      port: binding.port,
      closeAdmissions: () => runSync(binding.closeAdmissions),
    };
  });

async function client(port: number, clientId: string) {
  const connected = await connectWebSocketGateway({
    url: `ws://${WEB_SOCKET_GATEWAY_DEFAULTS.HOST}:${port}/`,
    headers: { [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}` },
    client: { clientId, role: GATEWAY_CLIENT_ROLE.OPERATOR },
  });
  assert.ok(connected.ok);
  let ids = 0;
  const gateway = new GatewayClient({
    transport: connected.connection,
    createId: () => `${clientId}-${++ids}`,
  });
  return { connection: connected.connection, gateway };
}

function recordOf(value: WireValue | undefined) {
  assert.ok(isRecord(value));
  return value;
}

it.live(
  "an ask survives the client that submitted it dying, and the next client reads it from the host",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = fakeHost();
        const { port } = yield* listen(f.service);
        yield* Effect.promise(async () => {
          const first = await client(port, "desktop-1");
          const submitted = await first.gateway.call(
            GATEWAY_METHOD.RUN_SUBMIT,
            {
              submissionId: "sub-1",
              question: "what needs me?",
              origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
            },
            { idempotencyKey: "sub-1" },
          );
          assert.ok(submitted.ok);
          assert.equal(recordOf(submitted.result).runId, "run-1");
          // The client is gone; the host is not.
          first.connection.close();
          await new Promise((resolve) => setTimeout(resolve, 20));
          assert.equal(f.live.get("run-1")?.status, BRAIN_REQUEST_STATUS.RUNNING);
          // The next client's hello snapshot and reads find the run and the host's lines.
          f.lines.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" });
          const second = await client(port, "desktop-2");
          const hello = await second.gateway.call(GATEWAY_METHOD.HELLO);
          assert.ok(hello.ok);
          const snapshot = recordOf(recordOf(hello.result).snapshot);
          assert.ok(Array.isArray(snapshot.runs) && snapshot.runs.length === 1);
          const listed = await second.gateway.call(GATEWAY_METHOD.CONVERSATION_LINES, {});
          assert.ok(listed.ok);
          const entries = recordOf(listed.result).entries;
          assert.ok(Array.isArray(entries) && entries.length === 1);
          second.connection.close();
        });
      }),
    ),
);

it.live("while no client stands, a native capability the host needs answers unavailable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = fakeHost();
      const { port } = yield* listen(f.service);
      yield* Effect.promise(async () => {
        const desktop = await client(port, "desktop");
        desktop.connection.serveInvocations?.(async () => ({
          status: NODE_CAPABILITY_STATUS.OK,
          value: undefined,
        }));
        assert.ok(
          (
            await desktop.gateway.call(GATEWAY_METHOD.NODE_REGISTER, {
              nodeId: HOST_NATIVE_NODE_ID,
              capabilities: [HOST_NODE_CAPABILITY.OPEN_EXTERNAL],
            })
          ).ok,
        );
        const served = await f.service.nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, {
          url: "https://a",
        });
        assert.equal(served.status, NODE_CAPABILITY_STATUS.OK);
        desktop.connection.close();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const absent = await f.service.nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, {
          url: "https://b",
        });
        assert.equal(absent.status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
      });
    }),
  ),
);

it.live(
  "the explicit shutdown closes admissions, cancels what runs, and counts unresolved from the persisted records, so a cancellation that never landed stays recoverable",
  () =>
    Effect.forEach(
      [true, false],
      (persistCancellations: boolean) =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = fakeHost({ persistCancellations });
            const { port, closeAdmissions } = yield* listen(f.service);
            yield* Effect.promise(async () => {
              const desktop = await client(port, "desktop");
              const submitted = await desktop.gateway.call(
                GATEWAY_METHOD.RUN_SUBMIT,
                { submissionId: "sub-q", question: "long", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
                { idempotencyKey: "sub-q" },
              );
              assert.ok(submitted.ok);
              const report = await shutdownGateway(
                {
                  closeAdmissions,
                  cancelActive: async () => {
                    const cancelled: string[] = [];
                    for (const held of f.live.values()) {
                      if (held.status !== BRAIN_REQUEST_STATUS.RUNNING) continue;
                      cancelled.push(held.runId);
                      await f.agent.cancelAsk(held.runId);
                    }
                    return cancelled;
                  },
                  awaitSettled: async () => undefined,
                  persistUnresolved: async () =>
                    [...f.persisted.values()].filter(
                      (held) =>
                        held.status === BRAIN_REQUEST_STATUS.QUEUED ||
                        held.status === BRAIN_REQUEST_STATUS.RUNNING,
                    ).length,
                },
                { deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS },
              );
              assert.deepEqual(report.cancelled, ["run-1"]);
              assert.equal(report.settled, true);
              // A cancellation the store took leaves nothing unresolved; one it did
              // not leaves the run running on disk, which the next launch marks
              // interrupted and never replays.
              assert.equal(report.unresolved, persistCancellations ? 0 : 1);
              // The door is closed: a new ask is refused as shutting down, a read still answers.
              const refused = await desktop.gateway.call(
                GATEWAY_METHOD.RUN_SUBMIT,
                { submissionId: "sub-late", question: "more", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
                { idempotencyKey: "sub-late" },
              );
              assert.equal(refused.ok, false);
              if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.SHUTTING_DOWN);
              assert.ok((await desktop.gateway.call(GATEWAY_METHOD.RUN_LIST)).ok);
              desktop.connection.close();
            });
          }),
        ),
      { discard: true },
    ),
);

test("a shutdown whose cancellation hangs still ends at the deadline with what did not settle counted", async () => {
  const report = await shutdownGateway(
    {
      closeAdmissions: () => undefined,
      cancelActive: () => new Promise(() => undefined),
      awaitSettled: async () => undefined,
      persistUnresolved: async () => 2,
    },
    { deadlineMs: 20 },
  );
  assert.equal(report.settled, false);
  assert.deepEqual(report.cancelled, []);
  assert.equal(report.unresolved, 2);
});
