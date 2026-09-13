import * as Socket from "@effect/platform/Socket";
import { Deferred, Effect, Mailbox, type Option, type Scope, type Stream } from "effect";
import type { WebSocket } from "ws";

/**
 * One `ws` socket as `@effect/platform` speaks it: the frames the peer sent
 * read into a mailbox by a fiber of the caller's own scope, so the service
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
 * the mailbox ends, so a stream over it completes rather than hanging on a
 * socket that is not there, nothing more is written to it, and closing the
 * scope closes the socket.
 */

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

export function voiceSocket(socket: WebSocket): Effect.Effect<VoiceSocket, never, Scope.Scope> {
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
      // wait for, so the reader ends at once and the mailbox with it.
      { closeCodeIsError: () => false, openTimeout: 0 },
    );
    const inbound = yield* Mailbox.make<VoiceFrame>();
    const writeRaw = yield* platform.writer;
    const standing = yield* Deferred.make<void>();
    let reading = false;
    yield* Effect.forkScoped(
      Effect.ensuring(
        Effect.ignore(
          platform.runRaw(
            (data) => {
              inbound.unsafeOffer(data instanceof Uint8Array ? { bytes: data } : { text: data });
            },
            {
              onOpen: Effect.sync(() => {
                reading = true;
                Deferred.unsafeDone(standing, Effect.void);
              }),
            },
          ),
        ),
        Effect.zipRight(
          Effect.sync(() => {
            reading = false;
            Deferred.unsafeDone(standing, Effect.void);
          }),
          inbound.end,
        ),
      ),
    );
    yield* Deferred.await(standing);
    const write = (chunk: string | Uint8Array | Socket.CloseEvent): Effect.Effect<void> =>
      Effect.suspend(() => (reading ? Effect.ignore(writeRaw(chunk)) : Effect.void));
    return {
      next: Effect.optionFromOptional(inbound.take),
      frames: Mailbox.toStream(inbound),
      send: (frame) => write("text" in frame ? frame.text : frame.bytes),
      close: (code, reason) => write(new Socket.CloseEvent(code, reason)),
      isOpen: Effect.sync(() => reading && socket.readyState === socket.OPEN),
    };
  });
}
