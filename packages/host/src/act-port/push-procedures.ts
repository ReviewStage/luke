import { MemoryPublisher } from "@orpc/publisher/memory";
import { type AppStateSnapshot, appStateDelivery } from "../app-state.js";
import {
  type EventPushName,
  PUSH,
  PUSH_PROCEDURE,
  type PushEvent,
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
 * What a stream sends of a document is what moved in it since the one it last
 * sent (`AppStateDelivery`), worked out as it is sent rather than as it is
 * pushed, so a document replaced unsent takes nothing it moved with it, and
 * a document in which nothing the window is handed moved is not sent at all.
 * A stream's first sends every entry, which is what makes a reloaded page's
 * new stream whole whatever its old one sent.
 *
 * A window the platform says is hidden may have its document held
 * (`holdState`): a document pushed to it still takes the unsent one's place,
 * but nothing is queued for it, and a marker queued before the hold and read
 * during it sends nothing, so the window renders nothing it cannot be seen
 * drawing. Its release queues the newest one at once, so the window is
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

type EventPush = Exclude<PushEvent, { readonly push: typeof PUSH.APP_STATE }>;

type Queued = PushEvent | typeof LATEST_STATE;

interface WindowStream {
  readonly publisher: MemoryPublisher<{ [PUSHED]: Queued }>;
  /** The newest document pushed since this stream last sent one. */
  unsent: AppStateSnapshot | undefined;
  /** The document this stream last sent what moved in, none before its first. */
  sent: AppStateSnapshot | undefined;
  /** Whether a marker is in the queue, which there is whenever a document is unsent and the window's document is not held. */
  marked: boolean;
  /** Whether the window's document is held, so a marker read now leaves the unsent document for the release. */
  held: boolean;
}

/** The stream's unsent document queued, if one is and its marker is not already. */
function mark(stream: WindowStream): void {
  if (stream.unsent === undefined || stream.marked) return;
  stream.marked = true;
  // Note that the publisher hands the event to every listener before its promise settles, so there is nothing to await.
  void stream.publisher.publish(PUSHED, LATEST_STATE);
}

/**
 * The stream's unsent document as the push it sends, what moved since the
 * one it last sent, taken off the stream; none where there is no document
 * unsent or nothing in it moved.
 */
function takeUnsent(stream: WindowStream): PushEvent | undefined {
  const latest = stream.unsent;
  stream.unsent = undefined;
  if (latest === undefined) return undefined;
  const delivery = appStateDelivery(stream.sent, latest);
  stream.sent = latest;
  return delivery === undefined ? undefined : { push: PUSH.APP_STATE, payload: delivery };
}

/** One event queued on one stream, behind the others. */
function offerEvent(stream: WindowStream, event: EventPush): void {
  // Note that a held document goes out itself before the event, because an
  // event must never be heard ahead of a document pushed before it, and a
  // marker read while held would send nothing.
  const latest = stream.held ? takeUnsent(stream) : undefined;
  if (latest !== undefined) void stream.publisher.publish(PUSHED, latest);
  void stream.publisher.publish(PUSHED, event);
}

/** One document queued on one stream, in its unsent one's place, queued only while the window's document is not held. */
function offerDocument(stream: WindowStream, document: AppStateSnapshot): void {
  stream.unsent = document;
  if (!stream.held) mark(stream);
}

/** Every window's push streams, keyed by the platform's handle on the window. */
export class WindowPushes<Sender = unknown> {
  readonly #windows = new Map<Sender, Set<WindowStream>>();
  /** The windows whose document is held, each until `holdState` releases it. */
  readonly #held = new Set<Sender>();

  /**
   * Pushes one event to every stream the window holds open, in the order
   * pushed; whether any stood to hear it.
   */
  push<Name extends EventPushName>(
    sender: Sender,
    push: Name,
    payload: PushPayload<Name>,
  ): boolean {
    const streams = this.#windows.get(sender);
    if (streams === undefined) return false;
    // SAFETY: `push` and `payload` are paired by this method's own signature, which is the pairing PushEvent names.
    const event = { push, payload } as EventPush;
    for (const stream of streams) offerEvent(stream, event);
    return true;
  }

  /**
   * Pushes the document as this window is handed it to every stream the
   * window holds open, in place of the one still unsent and held while the
   * window's document is; each stream sends what moved in it. Whether any
   * stood to hear it.
   */
  pushState(sender: Sender, document: AppStateSnapshot): boolean {
    const streams = this.#windows.get(sender);
    if (streams === undefined) return false;
    for (const stream of streams) offerDocument(stream, document);
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
    if (held) this.#held.add(sender);
    else if (!this.#held.delete(sender)) return;
    for (const stream of this.#windows.get(sender) ?? []) {
      stream.held = held;
      if (!held) mark(stream);
    }
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
      sent: undefined,
      marked: false,
      held: this.#held.has(sender),
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
 * unsent at the moment it is read, or left unsent while the window's document
 * is held, and its window's entry taken back as it ends.
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
      stream.marked = false;
      if (stream.held) continue;
      const latest = takeUnsent(stream);
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
