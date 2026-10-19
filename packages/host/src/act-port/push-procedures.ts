import { MemoryPublisher } from "@orpc/publisher/memory";
import {
  PUSH_PROCEDURE,
  type PushEvent,
  type PushName,
  type PushPayload,
} from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * push-procedures.ts -- what main pushes each window, held per window and streamed in order on that window's act port.
 *
 * Each window that has opened its stream has one publisher of its own
 * (oRPC's `MemoryPublisher`), keyed by the platform's handle on the window,
 * and a push to a window no stream of which stands is dropped, as a send to
 * a page with no listener was. The stream subscribes before the procedure
 * answers, so once a window's call resolves main is listening, and nothing
 * it pushes after that is lost; a stream's end, by the window's own
 * unsubscribe, its port closing with the window, or a reload replacing its
 * page, takes its listener back, and the window's publisher with its last.
 */

/** The one event every push to a window is published under. */
const PUSHED = "pushed";

/**
 * How many pushes a stream holds while the port is still sending the one
 * before. Note that none is ever dropped, because a document dropped from
 * the middle of a burst is a window drawn over a state it was never told.
 */
const UNBOUNDED = Number.POSITIVE_INFINITY;

interface WindowStreams {
  readonly publisher: MemoryPublisher<{ [PUSHED]: PushEvent }>;
  open: number;
}

/** Every window's push streams, keyed by the platform's handle on the window. */
export class WindowPushes<Sender = unknown> {
  readonly #windows = new Map<Sender, WindowStreams>();

  /**
   * Pushes one payload to every stream the window holds open, in the order
   * pushed; whether any stood to hear it.
   */
  push<Name extends PushName>(sender: Sender, push: Name, payload: PushPayload<Name>): boolean {
    const streams = this.#windows.get(sender);
    if (streams === undefined) return false;
    // SAFETY: `push` and `payload` are paired by this method's own signature, which is the pairing PushEvent names.
    const event = { push, payload } as PushEvent;
    // Note that the publisher hands the event to every listener before its promise settles, so there is nothing to await.
    void streams.publisher.publish(PUSHED, event);
    return true;
  }

  /** Whether the window holds a stream open, which it does from its call's answer until the stream ends. */
  listening(sender: Sender): boolean {
    return this.#windows.has(sender);
  }

  /**
   * One window's stream, subscribed now, ended by `signal` or by its reader
   * returning, whichever comes first.
   */
  stream(sender: Sender, signal: AbortSignal | undefined): AsyncIteratorObject<PushEvent> {
    const streams = this.#windows.get(sender) ?? {
      publisher: new MemoryPublisher<{ [PUSHED]: PushEvent }>({ maxBufferedEvents: UNBOUNDED }),
      open: 0,
    };
    this.#windows.set(sender, streams);
    streams.open += 1;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      streams.open -= 1;
      if (streams.open === 0 && this.#windows.get(sender) === streams) this.#windows.delete(sender);
    };
    signal?.addEventListener("abort", close, { once: true });
    // Note that the subscription is made here, before the stream is read, so
    // a push made the moment the window's call resolves is already held.
    return untilClosed(streams.publisher.subscribe(PUSHED, { signal }), close);
  }
}

/** A subscription read through, its window's count of streams taken back as it ends. */
async function* untilClosed(
  subscription: AsyncIteratorObject<PushEvent>,
  close: () => void,
): AsyncGenerator<PushEvent> {
  try {
    yield* subscription;
  } finally {
    close();
  }
}

/** The push stream's procedure, over the pushes main holds for every window. */
export function pushProcedures(pushes: WindowPushes) {
  return {
    [PUSH_PROCEDURE]: actPort[PUSH_PROCEDURE].handler(({ context, signal }) =>
      pushes.stream(context.actor.sender, signal),
    ),
  };
}
