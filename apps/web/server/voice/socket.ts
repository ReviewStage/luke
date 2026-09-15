import { type Cause, Deferred, Effect, Exit, Option, Queue, type Scope, Stream } from "effect";
import * as Socket from "effect/unstable/socket/Socket";
import type { WebSocket } from "ws";

/**
 * One `ws` socket as `effect/unstable/socket` speaks it: the frames the peer sent
 * read into a queue by a fiber of the caller's own scope, so the service
 * takes the opening frame from the same reader the relay then streams the
 * rest from and nothing arriving between the two lands nowhere. A frame
 * crosses as the bytes it arrived as — text as text, binary as binary — since
 * the service forwards what either side said rather than a re-serialization
 * of it.
 *
 * One reader for the socket's whole life is what makes that true, and it is
 * the one difference from the callbacks this replaced: those registered a
 * listener for the opening frame, dropped it, and registered another when the
 * pipe stood, so whatever a peer sent while the session was being stood up was
 * received and discarded. It is carried now, which is what the route's own
 * admission is for — the introduction still forwards only what a renderer's
 * data channel may send, whenever it was sent.
 *
 * The reader's listener stands before this answers, because `ws` emits a frame
 * to whoever listens at that instant: a caller holding a paused socket resumes
 * it on this answer and loses nothing that arrived meanwhile. Reading ends
 * when the peer goes, whether by a close handshake or by an error; either way
 * the queue ends, so a stream over it completes rather than hanging on a
 * socket that is not there, nothing more is written to it, and closing the
 * scope closes the socket.
 */

/** The WebSocket close codes this service sends, by what each one says. */
export const SOCKET_CLOSE_CODE = {
  NORMAL: 1000,
  /** The service itself is leaving, or the upstream left first. */
  GOING_AWAY: 1001,
  /** The peer sent something this route does not admit, or was refused. */
  POLICY_VIOLATION: 1008,
} as const;

/** The reason a socket is closed with when the peer has sent more than its budget of bytes. */
export const BUDGET_SPENT_REASON = "frame-budget-spent";

export type VoiceFrame = { readonly text: string } | { readonly bytes: Uint8Array };

export interface VoiceSocket {
  /** The next frame the peer sent, or nothing once it has gone. */
  readonly next: Effect.Effect<Option.Option<VoiceFrame>>;
  /** Every frame from here on, in the order they arrived, ending when the peer goes. */
  readonly frames: Stream.Stream<VoiceFrame>;
  /** Sends one frame; a socket that is no longer read takes it nowhere rather than waiting on it. */
  readonly send: (frame: VoiceFrame) => Effect.Effect<void>;
  readonly close: (code: number, reason?: string | undefined) => Effect.Effect<void>;
  /** Whether the peer is there and its reader stands, which is what makes a write worth making. */
  readonly isOpen: Effect.Effect<boolean>;
}

/** The bytes one frame carried, which is what the counts the service keeps are of. */
export function frameBytes(frame: VoiceFrame): number {
  return "text" in frame ? Buffer.byteLength(frame.text, "utf8") : frame.bytes.byteLength;
}

/** The text of one frame; a binary frame is not a Live event and reads as nothing. */
export function frameText(frame: VoiceFrame): string | undefined {
  return "text" in frame ? frame.text : undefined;
}

/**
 * The text frames a door took off a paused socket before its consumers stood,
 * handed to the listeners already standing on it, the sideband the exchange
 * reads, the way the socket itself would have handed them: emitted on the
 * socket's own `message` event, as the text each arrived as and in the order
 * it arrived. Called while the socket is still paused and before the reader
 * this module registers stands, since that reader resumes the socket the
 * moment it does; the pipe is handed the same frames through
 * {@link VoiceSocketOptions.held} instead. The caller hands over a copy of the
 * door's list, never the list: the door's own reader still stands on the
 * socket and holds again whatever is emitted to it while it is paused, which
 * is these frames on their way back.
 */
export function replayHeldFrames(socket: WebSocket, held: readonly string[]): void {
  for (const text of held) {
    socket.emit("message", Buffer.from(text, "utf8"), false);
  }
}

export interface VoiceSocketOptions {
  /**
   * How many bytes the peer may send before this closes the socket, counted
   * from the reader's first frame rather than from whenever a consumer stood,
   * so the frames a session holds while it is being stood up are spent as much
   * as the ones the pipe carries. A frame past the budget is not read at all
   * and the socket is closed with `BUDGET_SPENT_REASON`, so what a consumer
   * sees is the peer going, which is a hangup it already knows how to end.
   */
  readonly byteBudget?: number | undefined;
  /**
   * Text frames a door took off this socket before this reader stood, what a
   * primary socket said beside `session.started`, offered to the stream ahead
   * of anything the socket emits from here on, so a consumer reads them in
   * the order the far side said them. They spend no budget: the budget is
   * what a peer sends this service, and these are what the far side said
   * before anyone listened.
   */
  readonly held?: readonly string[] | undefined;
}

export function voiceSocket(
  socket: WebSocket,
  options: VoiceSocketOptions = {},
): Effect.Effect<VoiceSocket, never, Scope.Scope> {
  return Effect.gen(function* () {
    const platform = yield* Socket.fromWebSocket(
      Effect.acquireRelease(
        // SAFETY: `ws`'s socket is the WebSocket this reads; the DOM interface is the only name TypeScript has for it.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- `ws` and the DOM declare the same socket and share no declared type.
        Effect.succeed(socket as unknown as globalThis.WebSocket),
        (open) => Effect.sync(() => open.close()),
      ),
      // A socket handed over already gone never emits the `open` this would
      // otherwise wait the platform's ten seconds for: there is nothing to
      // wait for, so the reader ends at once and the queue with it. Every
      // ending is a failure of the read, a close handshake as much as an
      // error, which is why the reader is ignored rather than matched on.
      { openTimeout: 0 },
    );
    const inbound = yield* Queue.make<VoiceFrame, Cause.Done>();
    for (const text of options.held ?? []) {
      Queue.offerUnsafe(inbound, { text });
    }
    const writer = yield* platform.writer;
    const standing = yield* Deferred.make<void>();
    const overspent = yield* Deferred.make<void>();
    let reading = false;
    let spent = 0;
    const receive = (data: Uint8Array | string): void => {
      const frame = data instanceof Uint8Array ? { bytes: data } : { text: data };
      if (options.byteBudget !== undefined) {
        spent += frameBytes(frame);
        if (spent > options.byteBudget) {
          Deferred.doneUnsafe(overspent, Exit.void);
          return;
        }
      }
      Queue.offerUnsafe(inbound, frame);
    };
    yield* Effect.forkScoped(
      Effect.ensuring(
        Effect.ignore(
          Effect.scoped(
            Effect.gen(function* () {
              const reader = yield* platform.reader;
              reading = true;
              Deferred.doneUnsafe(standing, Effect.void);
              while (true) {
                const batch = yield* reader.pull;
                for (const data of batch) {
                  receive(data);
                }
              }
            }),
          ),
        ),
        Effect.andThen(
          Effect.sync(() => {
            reading = false;
            Deferred.doneUnsafe(standing, Effect.void);
          }),
          Queue.end(inbound),
        ),
      ),
    );
    yield* Deferred.await(standing);
    const write = (chunk: string | Uint8Array | Socket.CloseEvent): Effect.Effect<void> =>
      Effect.suspend(() => (reading ? Effect.ignore(writer.write(chunk)) : Effect.void));
    yield* Effect.forkScoped(
      Effect.andThen(
        Deferred.await(overspent),
        write(new Socket.CloseEvent(SOCKET_CLOSE_CODE.POLICY_VIOLATION, BUDGET_SPENT_REASON)),
      ),
    );
    return {
      next: Queue.take(inbound).pipe(
        Effect.map((frame): Option.Option<VoiceFrame> => Option.some(frame)),
        Effect.catchTag("Done", () => Effect.succeed(Option.none<VoiceFrame>())),
      ),
      frames: Stream.fromQueue(inbound),
      send: (frame) => write("text" in frame ? frame.text : frame.bytes),
      close: (code, reason) => write(new Socket.CloseEvent(code, reason)),
      isOpen: Effect.sync(() => reading && socket.readyState === socket.OPEN),
    };
  });
}
