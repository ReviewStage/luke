import { MemoryPublisher } from "@orpc/publisher/memory";
import {
  PUSH,
  PUSH_PROCEDURE,
  type PushEvent,
  type PushName,
  type PushPayload,
} from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * push-procedures.ts -- what main pushes each window, held per stream and streamed in order on that window's act port, the document latest-wins.
 *
 * Each stream a window opens has one publisher of its own (oRPC's
 * `MemoryPublisher`), the window's streams keyed by the platform's handle on
 * it, and a push to a window no stream of which stands is dropped, as a send
 * to a page with no listener was. The stream subscribes before the procedure
 * answers, so once a window's call resolves main is listening, and nothing
 * it pushes after that is lost; a stream's end, by the window's own
 * unsubscribe, its port closing with the window, or a reload replacing its
 * page, takes its listener back, and the window's entry with its last.
 *
 * Every push but the document is held and sent in the order pushed. The
 * document is the one push that is a state rather than an event: a stream
 * holds at most one still unsent, in the place of the first one pushed since
 * it last sent one, and a newer document replaces it there. So a stream that
 * falls behind sends the newest document next and never an older one, and an
 * event pushed after a document is still heard after a document at least as
 * new.
 *
 * A window the platform says is hidden may have its document held
 * (`holdState`): a document pushed to it still takes the unsent one's place,
 * but nothing is queued for it, so the window renders nothing it cannot be
 * seen drawing. Its release queues the newest one at once, so the window is
 * current before it is seen, and an event pushed meanwhile still goes out
 * behind the document unsent, so the order above holds while held too.
 * Only the push stream is held; a window's own calls still answer.
 */

/** The one event every push to a window is published under. */
const PUSHED = "pushed";

/**
 * How many pushes a stream holds while the port is still sending the one
 * before. Note that no event is ever dropped, because an event dropped from
 * the middle of a burst is a press, a command, or a feed chunk the window
 * was never told; the document is bounded by `LATEST_STATE` instead.
 */
const UNBOUNDED = Number.POSITIVE_INFINITY;

/** Where a stream's unsent document stands in its queue; the document itself is read as the marker is sent. */
const LATEST_STATE = Object.freeze({ latest: PUSH.APP_STATE });

type StatePush = Extract<PushEvent, { readonly push: typeof PUSH.APP_STATE }>;

type Queued = PushEvent | typeof LATEST_STATE;

interface WindowStream {
  readonly publisher: MemoryPublisher<{ [PUSHED]: Queued }>;
  /** The newest document pushed since this stream last sent one. */
  unsent: StatePush | undefined;
  /** Whether the unsent document's marker is in the queue, which it is whenever one is unsent and the window's document is not held. */
  marked: boolean;
}

/** The stream's unsent document queued, if one is and its marker is not already. */
function mark(stream: WindowStream): void {
  if (stream.unsent === undefined || stream.marked) return;
  stream.marked = true;
  // Note that the publisher hands the event to every listener before its promise settles, so there is nothing to await.
  void stream.publisher.publish(PUSHED, LATEST_STATE);
}

/**
 * One push queued on one stream: an event behind the others, a document in
 * its unsent one's place, queued only while the window's document is not
 * held.
 */
function offer(stream: WindowStream, event: PushEvent, held: boolean): void {
  if (event.push !== PUSH.APP_STATE) {
    // Note that a held document goes out before the event, because an event
    // must never be heard ahead of a document pushed before it.
    mark(stream);
    void stream.publisher.publish(PUSHED, event);
    return;
  }
  stream.unsent = event;
  if (!held) mark(stream);
}

/** Every window's push streams, keyed by the platform's handle on the window. */
export class WindowPushes<Sender = unknown> {
  readonly #windows = new Map<Sender, Set<WindowStream>>();
  /** The windows whose document is held, each until `holdState` releases it. */
  readonly #held = new Set<Sender>();

  /**
   * Pushes one payload to every stream the window holds open, in the order
   * pushed, a document in place of the one still unsent and held while the
   * window's document is; whether any stood to hear it.
   */
  push<Name extends PushName>(sender: Sender, push: Name, payload: PushPayload<Name>): boolean {
    const streams = this.#windows.get(sender);
    if (streams === undefined) return false;
    // SAFETY: `push` and `payload` are paired by this method's own signature, which is the pairing PushEvent names.
    const event = { push, payload } as PushEvent;
    const held = this.#held.has(sender);
    for (const stream of streams) offer(stream, event, held);
    return true;
  }

  /**
   * Holds the window's document, or releases it: while held, the newest
   * document pushed is kept and none is sent; released, that newest one is
   * queued at once. A window's own reload keeps the hold, which lasts until
   * this releases it, and a window that goes for good is released so its
   * handle is not kept.
   */
  holdState(sender: Sender, held: boolean): void {
    if (held) {
      this.#held.add(sender);
      return;
    }
    if (!this.#held.delete(sender)) return;
    for (const stream of this.#windows.get(sender) ?? []) mark(stream);
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
    const stream: WindowStream = {
      publisher: new MemoryPublisher<{ [PUSHED]: Queued }>({ maxBufferedEvents: UNBOUNDED }),
      unsent: undefined,
      marked: false,
    };
    const streams = this.#windows.get(sender) ?? new Set<WindowStream>();
    this.#windows.set(sender, streams);
    streams.add(stream);
    const close = () => {
      if (!streams.delete(stream)) return;
      if (streams.size === 0 && this.#windows.get(sender) === streams) this.#windows.delete(sender);
    };
    signal?.addEventListener("abort", close, { once: true });
    // Note that the subscription is made here, before the stream is read, so
    // a push made the moment the window's call resolves is already held.
    return untilClosed(stream, stream.publisher.subscribe(PUSHED, { signal }), close);
  }
}

/**
 * A stream's subscription read through, each marker sent as the document
 * unsent at the moment it is read, and its window's entry taken back as it
 * ends.
 */
async function* untilClosed(
  stream: WindowStream,
  subscription: AsyncIteratorObject<Queued>,
  close: () => void,
): AsyncGenerator<PushEvent> {
  try {
    for await (const queued of subscription) {
      if ("push" in queued) {
        yield queued;
        continue;
      }
      const latest = stream.unsent;
      stream.unsent = undefined;
      stream.marked = false;
      if (latest !== undefined) yield latest;
    }
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
