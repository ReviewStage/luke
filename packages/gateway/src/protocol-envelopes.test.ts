import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, type WireRecord, type WireValue } from "@sidecar/wire";
import { Effect } from "effect";
import { test } from "vitest";
import type { GatewayMethodTable } from "./methods.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayClientIdentity,
  type GatewayErrorCode,
  type GatewayMethod,
  type GatewayRequest,
  type GatewayResponse,
  gatewayRequestToWire,
  gatewayResponseToWire,
  isMutatingGatewayMethod,
  LIVE_TRANSPORT_STATE,
  NodeUnavailableRefusal,
  NotFoundRefusal,
  RefusedRefusal,
  UnknownCapabilityRefusal,
  voiceCreateLiveSessionParamsSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "./protocol.js";

import { type GatewayTestHost, gatewayTestHost, TextLoopbackTransport } from "./testing.js";

/**
 * The envelopes as they cross, recorded. Every case here is carried by the
 * text transport, so what a golden holds is what a socket would: the same
 * `toWire` writers, through JSON, and back through the same readers. The
 * bytes are the contract — key order included, which is why nothing sorts
 * them — so a rewrite of what composes an envelope is measured against these
 * files rather than against a reader's memory of them.
 *
 * One field is not recorded verbatim. An error's `message` is prose written
 * for a person and improved like prose; freezing it here would make a better
 * sentence read as a broken contract, so the golden carries a fixed token in
 * its place and the exchange asserts the live message is a non-empty string.
 * Every other value is structural or this file's own synthetic fixture.
 */

/** Records the envelopes instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

const FIXTURE_ROOT = path.join(fileURLToPath(import.meta.url), "../../fixtures/protocol");

const REDACTED_MESSAGE = "<message>";

const OPERATOR: GatewayClientIdentity = {
  clientId: "operator-fixture",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};

const NODE: GatewayClientIdentity = {
  clientId: "node-fixture",
  role: GATEWAY_CLIENT_ROLE.NODE,
};

const FIXTURE_INSTANT = 1_700_000_000_000;
const FIXTURE_CONFIGURATION_REVISION = 7;
const FIXTURE_SESSION_KEY = "agent:main:main";
const FIXTURE_SESSION_REVISION = "generation-1";
const FIXTURE_SNAPSHOT: WireValue = {
  kind: "snapshot",
  rows: [{ id: "row-1", state: "idle" }],
};
const FIXTURE_SDP = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

const METHODS: readonly GatewayMethod[] = Object.values(GATEWAY_METHOD);
const ERROR_CODES: readonly GatewayErrorCode[] = Object.values(GATEWAY_ERROR);

function slug(name: string): string {
  return name.replaceAll(".", "-").replaceAll("_", "-");
}

function methodGoldenName(method: GatewayMethod): string {
  return `method-${slug(method)}`;
}

function errorGoldenName(code: GatewayErrorCode): string {
  return `error-${slug(code)}`;
}

const REPLAY_GOLDEN_NAME = {
  INSIDE_WINDOW: "replay-inside-window",
  PAST_WINDOW: "replay-past-window",
} as const;

/**
 * The two shapes no per-method case reaches: a request that names the
 * revisions it was built over, and an answer that carries no result at all.
 * Both are written by `gatewayRequestToWire` and `gatewayResponseToWire` as
 * an absent field rather than a null, so both forms of each are recorded.
 */
const ENVELOPE_GOLDEN_NAME = {
  EXPECTED_REVISION: "envelope-expected-revision",
  EMPTY_RESULT: "envelope-empty-result",
} as const;

function goldenText(value: WireValue): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

async function settleGolden(name: string, recorded: WireRecord): Promise<void> {
  const filePath = path.join(FIXTURE_ROOT, `${name}.json`);
  const serialized = goldenText(recorded);
  if (UPDATE_FIXTURES) {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
    await fs.writeFile(filePath, serialized);
    return;
  }
  const held = await fs.readFile(filePath, "utf8").catch(() => undefined);
  assert.ok(held !== undefined, `no envelope recorded at ${filePath}`);
  assert.equal(serialized, held);
}

function responseGolden(response: GatewayResponse): WireRecord {
  const wire = gatewayResponseToWire(response);
  if (response.ok) return wire;
  assert.ok(response.error.message.length > 0);
  const written = wire.error;
  assert.ok(isRecord(written));
  return { ...wire, error: { ...written, message: REDACTED_MESSAGE } };
}

async function settleExchange(
  name: string,
  transport: TextLoopbackTransport,
  request: GatewayRequest,
): Promise<GatewayResponse> {
  const response = await transport.request(request);
  await settleGolden(name, {
    request: gatewayRequestToWire(request),
    response: responseGolden(response),
  });
  return response;
}

function goldenHost(
  methods: GatewayMethodTable,
  options: { replayWindow?: number } = {},
): Promise<GatewayTestHost> {
  let events = 0;
  return gatewayTestHost({
    methods,
    configurationRevision: () => FIXTURE_CONFIGURATION_REVISION,
    sessionRevision: (key) => (key === FIXTURE_SESSION_KEY ? FIXTURE_SESSION_REVISION : undefined),
    snapshot: () => FIXTURE_SNAPSHOT,
    now: () => FIXTURE_INSTANT + events * 1_000,
    createEventId: () => {
      events += 1;
      return `event-${events}`;
    },
    ...(options.replayWindow !== undefined ? { replayWindow: options.replayWindow } : undefined),
  });
}

/**
 * The parameters a method's own entry declares, and nothing invented. What
 * every other method takes belongs to the host that answers it rather than to
 * this vocabulary, so those cases carry one synthetic record whose whole job
 * is to show how a params record travels.
 */
const DECLARED_PARAMS: ReadonlyMap<GatewayMethod, WireRecord> = new Map<GatewayMethod, WireRecord>([
  [GATEWAY_METHOD.RECONNECT, { lastSequence: 0 }],
  [GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp: FIXTURE_SDP }],
  [GATEWAY_METHOD.VOICE_END_LIVE_SESSION, {}],
  [GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT, { state: LIVE_TRANSPORT_STATE.CONNECTED }],
  [GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY, { idle: false }],
  [GATEWAY_METHOD.VOICE_STOP_SPEAKING, {}],
]);

const SYNTHETIC_PARAMS: WireRecord = {
  note: "synthetic",
  detail: { flag: true, count: 2, absent: null, list: ["first", "second"] },
};

function paramsFor(method: GatewayMethod): WireRecord {
  return DECLARED_PARAMS.get(method) ?? { case: method, ...SYNTHETIC_PARAMS };
}

function requestFor(method: GatewayMethod): GatewayRequest {
  return {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: `request-${slug(method)}`,
    method,
    params: paramsFor(method),
    ...(isMutatingGatewayMethod(method) ? { idempotencyKey: `key-${slug(method)}` } : undefined),
  };
}

/** Every method answering its own name, so what the golden pins is the envelope rather than a host's result. */
function answeringTable(): GatewayMethodTable {
  const table: GatewayMethodTable = {};
  for (const method of METHODS) table[method] = () => Effect.succeed({ answered: method });
  return table;
}

test("the declared parameters the fixtures carry are the shapes the protocol admits", () => {
  assert.deepEqual(
    voiceCreateLiveSessionParamsSchema.parse(paramsFor(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION)),
    { sdp: FIXTURE_SDP },
  );
  assert.deepEqual(
    voiceReportLiveTransportParamsSchema.parse(
      paramsFor(GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT),
    ),
    { state: LIVE_TRANSPORT_STATE.CONNECTED },
  );
  assert.deepEqual(
    voiceReportLiveActivityParamsSchema.parse(paramsFor(GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY)),
    { idle: false },
  );
});

test("every method's request and answer cross as the recorded envelopes", async () => {
  const transport = new TextLoopbackTransport(await goldenHost(answeringTable()), OPERATOR);
  for (const method of METHODS) {
    const response = await settleExchange(methodGoldenName(method), transport, requestFor(method));
    assert.equal(response.ok, true);
  }
});

test("every error code crosses as the recorded envelope", async () => {
  const throwing = new Error("the handler failed");
  const unanswered = answeringTable();
  delete unanswered[GATEWAY_METHOD.MEMORY_STATUS];
  const host = await goldenHost({
    ...unanswered,
    [GATEWAY_METHOD.CONVERSATION_LINES]: () =>
      Effect.fail(new NotFoundRefusal({ message: "no conversation stands under that key" })),
    [GATEWAY_METHOD.SESSION_SEND_MESSAGE]: () =>
      Effect.fail(new RefusedRefusal({ message: "that session advertises no message" })),
    [GATEWAY_METHOD.NODE_INVOKE]: () =>
      Effect.fail(
        new NodeUnavailableRefusal({ message: "no connected node offers that capability" }),
      ),
    [GATEWAY_METHOD.SESSION_OPEN]: () =>
      Effect.fail(new UnknownCapabilityRefusal({ message: "that capability is not registered" })),
    [GATEWAY_METHOD.RUN_SUBMIT]: () => {
      throw throwing;
    },
  });
  const transport = new TextLoopbackTransport(host, OPERATOR);
  const nodeTransport = new TextLoopbackTransport(host, NODE);

  const conflicting = requestFor(GATEWAY_METHOD.CONFIGURATION_UPDATE);
  await transport.request(conflicting);

  const shuttingDown = await goldenHost(answeringTable());
  shuttingDown.closeAdmissions();
  const shuttingDownTransport = new TextLoopbackTransport(shuttingDown, OPERATOR);

  const disconnected = new TextLoopbackTransport(await goldenHost(answeringTable()), OPERATOR);
  disconnected.setConnected(false);

  const cases: readonly {
    code: GatewayErrorCode;
    transport: TextLoopbackTransport;
    request: GatewayRequest;
  }[] = [
    {
      code: GATEWAY_ERROR.UNSUPPORTED_VERSION,
      transport,
      request: { ...requestFor(GATEWAY_METHOD.HELLO), protocolVersion: 0 },
    },
    {
      code: GATEWAY_ERROR.UNKNOWN_METHOD,
      transport,
      request: requestFor(GATEWAY_METHOD.MEMORY_STATUS),
    },
    {
      code: GATEWAY_ERROR.INVALID_PARAMS,
      transport,
      request: { ...requestFor(GATEWAY_METHOD.RECONNECT), params: { lastSequence: -1 } },
    },
    {
      code: GATEWAY_ERROR.MISSING_IDEMPOTENCY_KEY,
      transport,
      request: {
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        id: "request-without-idempotency-key",
        method: GATEWAY_METHOD.RUN_CANCEL,
        params: paramsFor(GATEWAY_METHOD.RUN_CANCEL),
      },
    },
    {
      code: GATEWAY_ERROR.IDEMPOTENCY_CONFLICT,
      transport,
      request: { ...conflicting, params: { case: "reused key, other parameters" } },
    },
    {
      code: GATEWAY_ERROR.REVISION_MISMATCH,
      transport,
      request: {
        ...requestFor(GATEWAY_METHOD.SETTINGS_UPDATE),
        expectedRevision: { configurationRevision: FIXTURE_CONFIGURATION_REVISION + 1 },
      },
    },
    {
      code: GATEWAY_ERROR.NOT_FOUND,
      transport,
      request: requestFor(GATEWAY_METHOD.CONVERSATION_LINES),
    },
    {
      code: GATEWAY_ERROR.REFUSED,
      transport,
      request: requestFor(GATEWAY_METHOD.SESSION_SEND_MESSAGE),
    },
    {
      code: GATEWAY_ERROR.UNAUTHORIZED,
      transport: nodeTransport,
      request: requestFor(GATEWAY_METHOD.SESSION_ROSTER),
    },
    {
      code: GATEWAY_ERROR.NODE_UNAVAILABLE,
      transport,
      request: requestFor(GATEWAY_METHOD.NODE_INVOKE),
    },
    {
      code: GATEWAY_ERROR.UNKNOWN_CAPABILITY,
      transport,
      request: requestFor(GATEWAY_METHOD.SESSION_OPEN),
    },
    {
      code: GATEWAY_ERROR.DISCONNECTED,
      transport: disconnected,
      request: requestFor(GATEWAY_METHOD.SESSION_ROSTER),
    },
    {
      code: GATEWAY_ERROR.SHUTTING_DOWN,
      transport: shuttingDownTransport,
      request: requestFor(GATEWAY_METHOD.RUN_SUBMIT),
    },
    {
      code: GATEWAY_ERROR.INTERNAL,
      transport,
      request: requestFor(GATEWAY_METHOD.RUN_SUBMIT),
    },
  ];

  assert.deepEqual(cases.map((held) => held.code).toSorted(), [...ERROR_CODES].toSorted());
  for (const held of cases) {
    const response = await settleExchange(errorGoldenName(held.code), held.transport, held.request);
    assert.equal(response.ok, false);
    assert.equal(response.ok ? undefined : response.error.code, held.code);
  }
});

test("a reconnection inside the window replays, and one past it is handed a snapshot", async () => {
  const host = await goldenHost(answeringTable(), { replayWindow: 3 });
  const transport = new TextLoopbackTransport(host, OPERATOR);
  host.emit(GATEWAY_EVENT.SETTINGS_CHANGED, { setting: "first" });
  host.emit(GATEWAY_EVENT.ACCOUNT_CHANGED, { account: "second" });
  host.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
  host.emit(GATEWAY_EVENT.CONVERSATION_CHANGED, { lines: 1 }, { sessionKey: FIXTURE_SESSION_KEY });
  host.emit(
    GATEWAY_EVENT.RUNS_CHANGED,
    { runs: 1 },
    { sessionKey: FIXTURE_SESSION_KEY, runId: "run-1" },
  );

  const inside = await settleExchange(REPLAY_GOLDEN_NAME.INSIDE_WINDOW, transport, {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: "request-reconnect-inside-window",
    method: GATEWAY_METHOD.RECONNECT,
    params: { lastSequence: 2 },
  });
  assert.equal(inside.ok, true);

  const past = await settleExchange(REPLAY_GOLDEN_NAME.PAST_WINDOW, transport, {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: "request-reconnect-past-window",
    method: GATEWAY_METHOD.RECONNECT,
    params: { lastSequence: 1 },
  });
  assert.equal(past.ok, true);
});

test("a named revision and an empty answer cross as the recorded envelopes", async () => {
  const host = await goldenHost({
    ...answeringTable(),
    [GATEWAY_METHOD.GUIDE_REPORT]: () => Effect.succeed(undefined),
  });
  const transport = new TextLoopbackTransport(host, OPERATOR);

  const named = await settleExchange(ENVELOPE_GOLDEN_NAME.EXPECTED_REVISION, transport, {
    ...requestFor(GATEWAY_METHOD.RUN_SUBMIT),
    id: "request-with-expected-revision",
    expectedRevision: {
      sessionKey: FIXTURE_SESSION_KEY,
      sessionRevision: FIXTURE_SESSION_REVISION,
      configurationRevision: FIXTURE_CONFIGURATION_REVISION,
    },
  });
  assert.equal(named.ok, true);

  const empty = await settleExchange(
    ENVELOPE_GOLDEN_NAME.EMPTY_RESULT,
    transport,
    requestFor(GATEWAY_METHOD.GUIDE_REPORT),
  );
  assert.equal(empty.ok ? empty.result : "not answered", undefined);
});

test("the recorded envelopes are exactly the cases the protocol names", async () => {
  const expected = [
    ...METHODS.map(methodGoldenName),
    ...ERROR_CODES.map(errorGoldenName),
    ...Object.values(REPLAY_GOLDEN_NAME),
    ...Object.values(ENVELOPE_GOLDEN_NAME),
  ].map((name) => `${name}.json`);
  const held = await fs.readdir(FIXTURE_ROOT);
  if (UPDATE_FIXTURES) {
    for (const name of held) {
      if (!expected.includes(name)) await fs.rm(path.join(FIXTURE_ROOT, name));
    }
  }
  assert.deepEqual((await fs.readdir(FIXTURE_ROOT)).toSorted(), expected.toSorted());
});
