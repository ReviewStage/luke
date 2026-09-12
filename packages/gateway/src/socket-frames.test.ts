import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { WebSocket } from "ws";
import type { GatewayMethodTable } from "./methods.js";
import { NodeRegistry } from "./nodes.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  NODE_CAPABILITY_STATUS,
  NotFoundRefusal,
  nodeInvocationAnswerToWire,
  nodeInvocationFromWire,
  RefusedRefusal,
} from "./protocol.js";
import { GatewayEventLog } from "./server.js";
import {
  bearerAuthentication,
  GATEWAY_FRAME,
  GatewaySocketBinding,
  layerGatewaySocket,
  WEB_SOCKET_GATEWAY_DEFAULTS,
} from "./websocket.js";

/**
 * The frames a socket carries, recorded. The envelope goldens beside these
 * hold what one envelope looks like; these hold what the socket's own wrapper
 * puts around it — the frame kind, the one envelope under it, and the order
 * the frames arrive in for one exchange — so a rewrite of the binding is
 * measured against the bytes a client of an earlier build would have read
 * rather than against a reader's memory of them.
 *
 * An error's `message` is redacted for the same reason the envelope goldens
 * redact it: it is prose written for a person, and a better sentence must not
 * read as a broken contract. Every other value is structural or synthetic.
 */

/** Records the frames instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

const FIXTURE_ROOT = path.join(fileURLToPath(import.meta.url), "../../fixtures/socket");

const REDACTED_MESSAGE = "<message>";
const TOKEN = "a-shared-secret";
const CAPABILITY = "os.openExternal";
const NODE_ID = "desktop-native";
const FIXTURE_INSTANT = 1_700_000_000_000;
const FIXTURE_CONFIGURATION_REVISION = 7;
const FIXTURE_REPLAY_WINDOW = 2;

function goldenText(value: WireRecord): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

async function settleGolden(name: string, frames: readonly WireRecord[]): Promise<void> {
  const filePath = path.join(FIXTURE_ROOT, `${name}.json`);
  const serialized = goldenText({ frames });
  if (UPDATE_FIXTURES) {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
    await fs.writeFile(filePath, serialized);
    return;
  }
  const held = await fs.readFile(filePath, "utf8").catch(() => undefined);
  assert.ok(held !== undefined, `no frames recorded at ${filePath}`);
  assert.equal(serialized, held);
}

/** The one field recorded as a token: an error's own sentence, asserted said rather than frozen. */
function recordable(frame: WireRecord): WireRecord {
  const envelope = frame.envelope;
  if (!isRecord(envelope) || !isRecord(envelope.error)) return frame;
  assert.ok(isWireString(envelope.error.message) && envelope.error.message.length > 0);
  return {
    ...frame,
    envelope: { ...envelope, error: { ...envelope.error, message: REDACTED_MESSAGE } },
  };
}

function hostWithNodes() {
  const nodes = new NodeRegistry();
  let invocations = 0;
  let events = 0;
  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.RUN_LIST]: () => Effect.succeed({ runs: [] }),
    [GATEWAY_METHOD.MEMORY_STATUS]: () =>
      Effect.fail(new NotFoundRefusal({ message: "nothing stands" })),
    [GATEWAY_METHOD.NODE_REGISTER]: (params, context) => {
      const connection = context.connection;
      if (!connection || !isWireString(params.nodeId)) {
        return Effect.fail(new RefusedRefusal({ message: "no connection" }));
      }
      const nodeId = params.nodeId;
      nodes.registerRemote({
        nodeId,
        capabilities: [CAPABILITY],
        invoke: (capability, invoked) =>
          connection.invoke({
            invocationId: `invocation-${++invocations}`,
            nodeId,
            capability,
            params: invoked,
          }),
      });
      return Effect.succeed({ nodeId });
    },
  };
  const layer = layerGatewaySocket({
    methods: methods,
    configurationRevision: () => FIXTURE_CONFIGURATION_REVISION,
    sessionRevision: () => undefined,
    snapshot: () => ({ kind: "snapshot", rows: [] }),
    now: () => FIXTURE_INSTANT,
    createEventId: () => `event-${++events}`,
    replayWindow: FIXTURE_REPLAY_WINDOW,
    authenticate: bearerAuthentication(TOKEN),
  });
  return { layer, nodes };
}

function socketUrl(port: number): string {
  return `ws://${WEB_SOCKET_GATEWAY_DEFAULTS.HOST}:${port}/`;
}

function rawSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl(port), {
      headers: {
        [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}`,
        [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: "desktop",
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: GATEWAY_CLIENT_ROLE.OPERATOR,
      },
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(label);
}

const { layer, nodes } = hostWithNodes();

it.live("the frames one socket exchange carries, in order", () =>
  Effect.gen(function* () {
    const binding = yield* GatewaySocketBinding;
    const log = yield* GatewayEventLog;
    const seen: WireRecord[] = [];
    const socket = yield* Effect.promise(() => rawSocket(binding.port));
    socket.on("message", (data, isBinary) => {
      assert.equal(isBinary, false);
      const text = data.toString();
      // A frame is one document: the binding wraps one envelope and never
      // several, so a reader may take a frame as a whole line.
      assert.equal(text.includes("\n"), false);
      // SAFETY: the host sends JSON text frames; the readers beside this check the shape.
      const value = JSON.parse(text) as UnparsedWireValue;
      assert.ok(isRecord(value));
      seen.push(recordable(value));
    });
    const send = (id: string, method: string, params: WireRecord) =>
      Effect.sync(() => {
        socket.send(
          JSON.stringify({
            kind: GATEWAY_FRAME.REQUEST,
            envelope: {
              protocolVersion: GATEWAY_PROTOCOL_VERSION,
              id,
              method,
              params,
              idempotencyKey: id,
            },
          }),
        );
      });
    const frames = (kind: string) => seen.filter((frame) => frame.kind === kind);
    const answered = (count: number, label: string) =>
      Effect.promise(() => until(() => frames(GATEWAY_FRAME.RESPONSE).length >= count, label));

    yield* send("request-run-list", GATEWAY_METHOD.RUN_LIST, {});
    yield* answered(1, "the read answered");

    yield* send("request-memory-status", GATEWAY_METHOD.MEMORY_STATUS, {});
    yield* answered(2, "the refusal answered");

    // A request the host cannot read at all: refused under the id the
    // envelope carried, as the binding has always refused one.
    yield* Effect.sync(() =>
      socket.send(
        JSON.stringify({ kind: GATEWAY_FRAME.REQUEST, envelope: { id: "request-torn" } }),
      ),
    );
    yield* answered(3, "the unreadable request answered");

    yield* log.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    yield* Effect.promise(() =>
      until(() => frames(GATEWAY_FRAME.EVENT).length === 1, "the event reached the client"),
    );

    yield* send("request-node-register", GATEWAY_METHOD.NODE_REGISTER, { nodeId: NODE_ID });
    yield* answered(4, "the registration answered");

    const invoked = nodes.invoke(CAPABILITY, { url: "https://example.test" });
    yield* Effect.promise(() =>
      until(() => frames(GATEWAY_FRAME.INVOCATION).length === 1, "the invocation reached the node"),
    );
    const dispatched = frames(GATEWAY_FRAME.INVOCATION)[0];
    assert.ok(dispatched && isRecord(dispatched.envelope));
    const invocation = nodeInvocationFromWire(dispatched.envelope);
    assert.ok(invocation);
    yield* Effect.sync(() =>
      socket.send(
        JSON.stringify({
          kind: GATEWAY_FRAME.ANSWER,
          envelope: nodeInvocationAnswerToWire({
            invocationId: invocation.invocationId,
            result: { status: NODE_CAPABILITY_STATUS.OK, value: "opened" },
          }),
        }),
      ),
    );
    assert.deepEqual(yield* Effect.promise(() => invoked), {
      status: NODE_CAPABILITY_STATUS.OK,
      value: "opened",
    });

    // Two more events, so the window of two has moved past the first: a
    // reconnection from inside it is replayed and one from before it is
    // handed the snapshot instead.
    yield* log.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    yield* log.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    yield* Effect.promise(() =>
      until(() => frames(GATEWAY_FRAME.EVENT).length === 3, "both events reached the client"),
    );

    yield* send("request-replay-inside", GATEWAY_METHOD.RECONNECT, { lastSequence: 2 });
    yield* answered(5, "the replay answered");
    yield* send("request-replay-past", GATEWAY_METHOD.RECONNECT, { lastSequence: 0 });
    yield* answered(6, "the snapshot answered");

    yield* Effect.sync(() => socket.close());
    yield* Effect.promise(() => settleGolden("exchange", seen));
  }).pipe(Effect.provide(layer)),
);
