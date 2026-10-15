import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { VOICE_SERVICE_FRAME } from "@sidecar/features";
import {
  commentaryAppend,
  instructionsAppend,
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
} from "@sidecar/live";
import type { WireRecord } from "@sidecar/wire";
import { type Cause, Effect, Option, Queue, Stream } from "effect";
import { OPENING_OUTCOME, relaySession } from "../server/voice/relay";
import type { VoiceFrame, VoiceSocket } from "../server/voice/socket";
import { sessionStarted } from "./support/live-events";

/**
 * The relay's opening over two in-memory sockets standing for the device and
 * OpenAI's sideband: the greeting's cue goes up as soon as the opening is
 * acknowledged on a call that held nothing, and waits for the device's
 * `session.greet` on a call that asked for the greeting held, which its
 * hang-up drops.
 */

const OPENING_ID = "opening-1";
const CUE_ID = "cue-1";

/** One side of the pipe: what its peer sends is offered in, and what the relay sent is kept. */
function fakeSocket() {
  return Effect.gen(function* () {
    const inbound = yield* Queue.make<VoiceFrame, Cause.Done>();
    const sent: string[] = [];
    let open = true;
    const socket: VoiceSocket = {
      next: Effect.map(Queue.take(inbound), Option.some).pipe(
        Effect.catchTag("Done", () => Effect.succeed(Option.none<VoiceFrame>())),
      ),
      frames: Stream.fromQueue(inbound),
      send: (frame) =>
        Effect.sync(() => {
          if (open && "text" in frame) sent.push(frame.text);
        }),
      close: () =>
        Effect.andThen(
          Effect.sync(() => {
            open = false;
          }),
          Queue.end(inbound),
        ),
      isOpen: Effect.sync(() => open),
    };
    const receive = (frame: WireRecord | LiveServerEvent) =>
      Effect.andThen(Queue.offer(inbound, { text: JSON.stringify(frame) }), settle());
    return { socket, sent, receive };
  });
}

function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

/** A call relayed with the service's opening and its cue, the greeting held or not. */
function call(holdGreeting: boolean) {
  return Effect.gen(function* () {
    const device = yield* fakeSocket();
    const upstream = yield* fakeSocket();
    yield* Effect.forkScoped(
      relaySession({
        device: device.socket,
        upstream: upstream.socket,
        holdGreeting,
        onSessionStarted: () =>
          instructionsAppend({ eventId: OPENING_ID, delegationId: null, content: "Greet." }),
        onOpeningSettled: (settled) =>
          settled.outcome === OPENING_OUTCOME.ACKNOWLEDGED
            ? commentaryAppend({ eventId: CUE_ID, delegationId: null, content: "Begin." })
            : undefined,
      }),
    );
    yield* settle();
    const started = upstream.receive(sessionStarted("ls_1"));
    const acknowledged = upstream.receive({
      type: LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
      event_id: "evt_ack",
      client_event_id: OPENING_ID,
      start_ms: 0,
      end_ms: 0,
    });
    const greet = device.receive({ type: VOICE_SERVICE_FRAME.SESSION_GREET });
    const hangUp = device.receive({ type: VOICE_SERVICE_FRAME.SESSION_HANG_UP });
    /** The cues that went up to OpenAI. */
    const cues = () =>
      upstream.sent
        .map((text) => JSON.parse(text))
        .filter((event) => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND)
        .map((event) => event.event_id);
    return { started, acknowledged, greet, hangUp, cues };
  });
}

it.effect("a call that held nothing is cued as soon as its opening is acknowledged", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* call(false);
      yield* f.started;
      yield* f.acknowledged;

      assert.deepEqual(f.cues(), [CUE_ID]);
    }),
  ),
);

it.effect("a held greeting is cued only once the device lets it go, and only once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* call(true);
      yield* f.started;
      yield* f.acknowledged;
      assert.deepEqual(f.cues(), []);

      yield* f.greet;
      yield* f.greet;

      assert.deepEqual(f.cues(), [CUE_ID]);
    }),
  ),
);

it.effect("a greet that arrives before the acknowledgment lets the cue go with it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* call(true);
      yield* f.started;
      yield* f.greet;
      assert.deepEqual(f.cues(), []);

      yield* f.acknowledged;

      assert.deepEqual(f.cues(), [CUE_ID]);
    }),
  ),
);

it.effect("a hang-up drops a held greeting, so a greet behind it cues nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* call(true);
      yield* f.started;
      yield* f.acknowledged;

      yield* f.hangUp;
      yield* f.greet;

      assert.deepEqual(f.cues(), []);
    }),
  ),
);
