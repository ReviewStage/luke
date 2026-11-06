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

const PUSHED = "pushed";

const UNBOUNDED = Number.POSITIVE_INFINITY;

const LATEST_STATE = Object.freeze({ latest: PUSH.APP_STATE });

type EventPush = Exclude<PushEvent, { readonly push: typeof PUSH.APP_STATE }>;

type Queued = PushEvent | typeof LATEST_STATE;

interface WindowStream {
  readonly publisher: MemoryPublisher<{ [PUSHED]: Queued }>;
  unsent: AppStateSnapshot | undefined;
  sent: AppStateSnapshot | undefined;
  marked: boolean;
  held: boolean;
}

function mark(stream: WindowStream): void {
  if (stream.unsent === undefined || stream.marked) return;
  stream.marked = true;
  void stream.publisher.publish(PUSHED, LATEST_STATE);
}

function takeUnsent(stream: WindowStream): PushEvent | undefined {
  const latest = stream.unsent;
  stream.unsent = undefined;
  if (latest === undefined) return undefined;
  const delivery = appStateDelivery(stream.sent, latest);
  stream.sent = latest;
  return delivery === undefined ? undefined : { push: PUSH.APP_STATE, payload: delivery };
}

function offerEvent(stream: WindowStream, event: EventPush): void {
  const latest = stream.held ? takeUnsent(stream) : undefined;
  if (latest !== undefined) void stream.publisher.publish(PUSHED, latest);
  void stream.publisher.publish(PUSHED, event);
}

function offerDocument(stream: WindowStream, document: AppStateSnapshot): void {
  stream.unsent = document;
  if (!stream.held) mark(stream);
}

export class WindowPushes<Sender = unknown> {
  readonly #windows = new Map<Sender, Set<WindowStream>>();
  readonly #held = new Set<Sender>();

  push<Name extends EventPushName>(
    sender: Sender,
    push: Name,
    payload: PushPayload<Name>,
  ): boolean {
    const streams = this.#windows.get(sender);
    if (streams === undefined) return false;
    const event = { push, payload } as EventPush;
    for (const stream of streams) offerEvent(stream, event);
    return true;
  }

  pushState(sender: Sender, document: AppStateSnapshot): boolean {
    const streams = this.#windows.get(sender);
    if (streams === undefined) return false;
    for (const stream of streams) offerDocument(stream, document);
    return true;
  }

  holdState(sender: Sender, held: boolean): void {
    if (held) this.#held.add(sender);
    else if (!this.#held.delete(sender)) return;
    for (const stream of this.#windows.get(sender) ?? []) {
      stream.held = held;
      if (!held) mark(stream);
    }
  }

  listening(sender: Sender): boolean {
    return this.#windows.has(sender);
  }

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
    return untilClosed(stream, stream.publisher.subscribe(PUSHED, { signal }), close);
  }
}

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

export function pushProcedures(pushes: WindowPushes) {
  return {
    [PUSH_PROCEDURE]: actPort[PUSH_PROCEDURE].handler(({ context, signal }) =>
      pushes.stream(context.actor.sender, signal),
    ),
  };
}
