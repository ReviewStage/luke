import { type Cause, Deferred, Effect, Exit, Option, Queue, type Scope, Stream } from "effect";
import * as Socket from "effect/socket/Socket";
import type { WebSocket } from "ws";

export const SOCKET_CLOSE_CODE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  POLICY_VIOLATION: 1008,
} as const;

const BUDGET_SPENT_REASON = "frame-budget-spent";

export type VoiceFrame = { readonly text: string } | { readonly bytes: Uint8Array };

export interface VoiceSocket {
  readonly next: Effect.Effect<Option.Option<VoiceFrame>>;
  readonly frames: Stream.Stream<VoiceFrame>;
  readonly send: (frame: VoiceFrame) => Effect.Effect<void>;
  readonly close: (code: number, reason?: string | undefined) => Effect.Effect<void>;
  readonly isOpen: Effect.Effect<boolean>;
}

export function frameBytes(frame: VoiceFrame): number {
  return "text" in frame ? Buffer.byteLength(frame.text, "utf8") : frame.bytes.byteLength;
}

export function frameText(frame: VoiceFrame): string | undefined {
  return "text" in frame ? frame.text : undefined;
}

export interface VoiceSocketOptions {
  readonly byteBudget?: number | undefined;
}

export function voiceSocket(
  socket: WebSocket,
  options: VoiceSocketOptions = {},
): Effect.Effect<VoiceSocket, never, Scope.Scope> {
  return Effect.gen(function* () {
    const platform = yield* Socket.fromWebSocket(
      Effect.acquireRelease(Effect.succeed(socket as unknown as globalThis.WebSocket), (open) =>
        Effect.sync(() => open.close()),
      ),
      { openTimeout: 0 },
    );
    const inbound = yield* Queue.make<VoiceFrame, Cause.Done>();
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
