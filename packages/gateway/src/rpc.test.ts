import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { isRecord, valueFromJsonText, type WireRecord, type WireValue } from "@sidecar/wire";
import { Effect, Exit, Option, Schema } from "effect";
import { test } from "vitest";
import {
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_REFUSALS,
  type GatewayErrorCode,
  GatewayParamsSchema,
  GatewayRefusalSchema,
  GatewayResultSchema,
  type GatewayRevision,
  gatewayVersionRefusal,
  isMutatingGatewayMethod,
  UnsupportedVersionRefusal,
} from "./protocol.js";
import {
  GATEWAY_EVENT_STREAM_REQUEST_ID,
  GATEWAY_REQUEST_HEADER,
  GatewayRpcs,
  gatewayEnvelopeSerialization,
  gatewayRequestVersion,
  gatewayRpcMutates,
} from "./rpc.js";

/**
 * The Rpc model against the recorded envelopes. Every round trip here starts
 * from a golden `fixtures/protocol` holds, carries it through the
 * serialization into the Rpc runtime's own message and back, and asserts the
 * bytes that come out are the bytes that went in: the serialization is what
 * lets an Rpc server and client speak to a client of an earlier build, so a
 * byte it moved would be a protocol it moved.
 */

const FIXTURE_ROOT = path.join(fileURLToPath(import.meta.url), "../../fixtures/protocol");

const REDACTED_MESSAGE = "<message>";

const RECORDED_REVISION: GatewayRevision = { configuration: 7, sequence: 0 };

const GOLDEN = {
  RUN_SUBMIT: "method-run-submit",
  EXPECTED_REVISION: "envelope-expected-revision",
  EMPTY_RESULT: "envelope-empty-result",
  NOT_FOUND: "error-not-found",
  UNSUPPORTED_VERSION: "error-unsupported-version",
  REPLAY_INSIDE_WINDOW: "replay-inside-window",
} as const;

interface Golden {
  request: WireRecord;
  response: WireRecord;
}

function recordOf(value: WireValue | undefined): WireRecord {
  assert.ok(isRecord(value));
  return value;
}

async function golden(name: string): Promise<Golden> {
  const text = await fs.readFile(path.join(FIXTURE_ROOT, `${name}.json`), "utf8");
  const held = recordOf(valueFromJsonText(text));
  return { request: recordOf(held.request), response: recordOf(held.response) };
}

/** The recorded events of the replay golden, each one an event envelope as the socket would carry it. */
async function recordedEvents(): Promise<readonly WireRecord[]> {
  const held = await golden(GOLDEN.REPLAY_INSIDE_WINDOW);
  const events = recordOf(held.response.result).events;
  assert.ok(Array.isArray(events));
  return events.map(recordOf);
}

function frame(value: WireValue): string {
  return JSON.stringify(value);
}

function parserWith(revision: GatewayRevision = RECORDED_REVISION) {
  return gatewayEnvelopeSerialization({ revision: () => revision }).unsafeMake();
}

function onlyMessage(messages: ReadonlyArray<unknown>) {
  assert.equal(messages.length, 1);
  return messages[0];
}

/** A decoded request's headers, as the Rpc runtime types them, read back off the message the parser answered. */
const carriesHeaders = Schema.is(
  Schema.Struct({ headers: Schema.Array(Schema.Tuple(Schema.String, Schema.String)) }),
);

/** The golden's response with its error message redacted the way the golden itself was recorded. */
function redacted(text: string | Uint8Array | undefined): WireRecord {
  assert.ok(text !== undefined);
  assert.ok(!(text instanceof Uint8Array));
  const written = recordOf(valueFromJsonText(text));
  if (!isRecord(written.error)) return written;
  return { ...written, error: { ...written.error, message: REDACTED_MESSAGE } };
}

test("the group holds exactly the table's methods, each annotated with its own mutates flag", () => {
  const names = [...GatewayRpcs.requests.keys()].toSorted();
  assert.deepEqual(names, Object.values(GATEWAY_METHOD).toSorted());
  for (const [name, rpc] of GatewayRpcs.requests) {
    assert.equal(rpc._tag, name);
    assert.deepEqual(gatewayRpcMutates(rpc), Option.some(isMutatingGatewayMethod(rpc._tag)));
    assert.equal(rpc.payloadSchema, GatewayParamsSchema);
    assert.equal(rpc.successSchema, GatewayResultSchema);
    assert.equal(rpc.errorSchema, GatewayRefusalSchema);
  }
});

it.effect(
  "every error code decodes to its own refusal class and encodes back to the code and message alone",
  () =>
    Effect.gen(function* () {
      const tags = new Set<string>(GATEWAY_REFUSALS.map((refusal) => refusal.name));
      const codes: readonly GatewayErrorCode[] = Object.values(GATEWAY_ERROR);
      assert.equal(tags.size, codes.length);
      for (const code of codes) {
        const refusal = yield* Schema.decode(GatewayRefusalSchema)({ code, message: "said" });
        assert.equal(refusal.code, code);
        assert.equal(refusal.message, "said");
        assert.ok(tags.has(refusal._tag));
        const encoded = yield* Schema.encode(GatewayRefusalSchema)(refusal);
        assert.deepEqual(encoded, { code, message: "said" });
        assert.deepEqual(Object.keys(encoded), ["code", "message"]);
      }
    }),
);

it.effect(
  "a request envelope becomes an Rpc request whose headers carry what the envelope kept beside the method, and comes back byte for byte",
  () =>
    Effect.gen(function* () {
      const parser = parserWith();
      const submit = yield* Effect.promise(() => golden(GOLDEN.RUN_SUBMIT));
      const carried = onlyMessage(parser.decode(frame(submit.request)));
      assert.deepEqual(carried, {
        _tag: "Request",
        id: "request-run-submit",
        tag: GATEWAY_METHOD.RUN_SUBMIT,
        payload: submit.request.params,
        headers: [
          [GATEWAY_REQUEST_HEADER.PROTOCOL_VERSION, String(GATEWAY_PROTOCOL_VERSION)],
          [GATEWAY_REQUEST_HEADER.IDEMPOTENCY_KEY, "key-run-submit"],
        ],
      });
      assert.equal(parser.encode(carried), frame(submit.request));

      const named = yield* Effect.promise(() => golden(GOLDEN.EXPECTED_REVISION));
      const namedMessage = onlyMessage(parser.decode(frame(named.request)));
      assert.ok(carriesHeaders(namedMessage));
      assert.deepEqual(namedMessage.headers.slice(2), [
        [GATEWAY_REQUEST_HEADER.EXPECTED_SESSION_KEY, "agent:main:main"],
        [GATEWAY_REQUEST_HEADER.EXPECTED_SESSION_REVISION, "generation-1"],
        [GATEWAY_REQUEST_HEADER.EXPECTED_CONFIGURATION_REVISION, "7"],
      ]);
      assert.equal(parser.encode(namedMessage), frame(named.request));
    }),
);

it.effect(
  "an answer envelope becomes an Rpc exit and comes back byte for byte, with and without a result",
  () =>
    Effect.gen(function* () {
      const parser = parserWith();
      for (const name of [GOLDEN.RUN_SUBMIT, GOLDEN.EMPTY_RESULT]) {
        const held = yield* Effect.promise(() => golden(name));
        const carried = onlyMessage(parser.decode(frame(held.response)));
        assert.deepEqual(carried, {
          _tag: "Exit",
          requestId: held.response.id,
          exit: { _tag: "Success", value: held.response.result },
        });
        assert.equal(parser.encode(carried), frame(held.response));
      }
    }),
);

it.effect(
  "an error envelope becomes a failed Rpc exit carrying the refusal's wire form, and comes back byte for byte",
  () =>
    Effect.gen(function* () {
      const parser = parserWith();
      const held = yield* Effect.promise(() => golden(GOLDEN.NOT_FOUND));
      const carried = onlyMessage(parser.decode(frame(held.response)));
      assert.deepEqual(carried, {
        _tag: "Exit",
        requestId: held.response.id,
        exit: {
          _tag: "Failure",
          cause: {
            _tag: "Fail",
            error: { code: GATEWAY_ERROR.NOT_FOUND, message: REDACTED_MESSAGE },
          },
        },
      });
      assert.equal(parser.encode(carried), frame(held.response));
    }),
);

it.effect(
  "a version the host does not speak is refused with the recorded error code, before any method is named",
  () =>
    Effect.gen(function* () {
      const parser = parserWith();
      const held = yield* Effect.promise(() => golden(GOLDEN.UNSUPPORTED_VERSION));
      const carried = onlyMessage(parser.decode(frame(held.request)));
      assert.ok(carriesHeaders(carried));
      const spoken = gatewayRequestVersion(carried.headers);
      assert.equal(spoken, 0);
      const refusal = gatewayVersionRefusal(spoken);
      assert.ok(Option.isSome(refusal));
      assert.ok(refusal.value instanceof UnsupportedVersionRefusal);
      assert.equal(refusal.value.code, GATEWAY_ERROR.UNSUPPORTED_VERSION);
      assert.deepEqual(gatewayVersionRefusal(GATEWAY_PROTOCOL_VERSION), Option.none());
      assert.equal(gatewayRequestVersion([]), GATEWAY_PROTOCOL_VERSION);

      const exit = Exit.fail(refusal.value);
      const encodedExit = yield* Schema.encode(
        Schema.Exit({
          success: GatewayResultSchema,
          failure: GatewayRefusalSchema,
          defect: Schema.Defect,
        }),
      )(exit);
      const written = parser.encode({
        _tag: "Exit",
        requestId: held.request.id,
        exit: encodedExit,
      });
      assert.deepEqual(redacted(written), held.response);
    }),
);

it.effect(
  "an event envelope becomes a chunk of the one event stream and comes back byte for byte",
  () =>
    Effect.gen(function* () {
      const parser = parserWith();
      const events = yield* Effect.promise(recordedEvents);
      assert.equal(events.length, 3);
      for (const event of events) {
        const carried = onlyMessage(parser.decode(frame(event)));
        assert.deepEqual(carried, {
          _tag: "Chunk",
          requestId: GATEWAY_EVENT_STREAM_REQUEST_ID,
          values: [event],
        });
        assert.equal(parser.encode(carried), frame(event));
      }
      const batched = parser.encode({
        _tag: "Chunk",
        requestId: GATEWAY_EVENT_STREAM_REQUEST_ID,
        values: events,
      });
      assert.ok(batched !== undefined);
      assert.equal(parser.decode(batched).length, events.length);
    }),
);

test("a defect or an interruption answers as an internal error, and a message the envelope has no shape for is written as nothing", () => {
  const parser = parserWith();
  const died = parser.encode({
    _tag: "Exit",
    requestId: "request-1",
    exit: Exit.die(new Error("the handler fell over")).pipe((exit) =>
      Schema.encodeSync(
        Schema.Exit({
          success: GatewayResultSchema,
          failure: GatewayRefusalSchema,
          defect: Schema.Defect,
        }),
      )(exit),
    ),
  });
  assert.deepEqual(redacted(died), {
    id: "request-1",
    ok: false,
    error: { code: GATEWAY_ERROR.INTERNAL, message: REDACTED_MESSAGE },
    revision: RECORDED_REVISION,
  });
  const interrupted = parser.encode({
    _tag: "Exit",
    requestId: "request-2",
    exit: { _tag: "Failure", cause: { _tag: "Interrupt", fiberId: { _tag: "None" } } },
  });
  assert.equal(recordOf(redacted(interrupted).error).code, GATEWAY_ERROR.INTERNAL);
  assert.equal(parser.encode({ _tag: "Ping" }), undefined);
  assert.equal(parser.encode({ _tag: "Ack", requestId: "1" }), undefined);
  assert.equal(parser.encode({ _tag: "Defect", defect: "lost" }), undefined);
});

test("a frame the envelope does not read is dropped rather than refused", () => {
  const parser = parserWith();
  assert.deepEqual(parser.decode("not json"), []);
  assert.deepEqual(
    parser.decode(frame({ invocationId: "i-1", nodeId: "n", capability: "c", params: {} })),
    [],
  );
  assert.deepEqual(
    parser.decode(frame({ method: "not.a.method", id: "x", protocolVersion: 1, params: {} })),
    [],
  );
  assert.deepEqual(parser.decode(new TextEncoder().encode(frame({ ok: true }))), []);
  assert.equal(
    gatewayEnvelopeSerialization({ revision: () => RECORDED_REVISION }).includesFraming,
    false,
  );
});
