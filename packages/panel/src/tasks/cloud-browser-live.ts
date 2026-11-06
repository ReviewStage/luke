import type { BrowserLiveTarget } from "@repo/features/browser-live-acts";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_CODE,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_REFUSAL,
  BROWSER_LIVE_SERVER,
  type BrowserLiveClientMessage,
  type BrowserLiveCloseReason,
  type BrowserLiveHistory,
  type BrowserLiveServerMessage,
  browserLiveServerMessageSchema,
} from "@repo/features/browser-live-wire";
import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import {
  Data,
  Duration,
  Effect,
  MutableRef,
  Queue,
  Result,
  Schedule,
  Stream,
  SubscriptionRef,
} from "effect";

export interface BrowserLiveListener {
  message(text: string): void;
  closed(code: number): void;
}

export interface BrowserLiveSocket {
  send(text: string): void;
  close(): void;
}

export type OpenBrowserLive = (
  target: BrowserLiveTarget,
  listener: BrowserLiveListener,
) => BrowserLiveSocket;

const CLOUD_BROWSER_RECONNECT = {
  FIRST: Duration.seconds(1),
  LONGEST: Duration.seconds(30),
  NOT_OPENED_EVERY: Duration.seconds(5),
} as const;

const CLOUD_BROWSER_WATCHING_EVERY = Duration.minutes(1);

export const CLOUD_BROWSER_PHASE = {
  CONNECTING: "connecting",
  LIVE: "live",
  RECONNECTING: "reconnecting",
  ENDED: "ended",
} as const;

type CloudBrowserPhase = (typeof CLOUD_BROWSER_PHASE)[keyof typeof CLOUD_BROWSER_PHASE];

type ServerOf<Type extends BrowserLiveServerMessage["type"]> = Extract<
  BrowserLiveServerMessage,
  { type: Type }
>;

export type CloudBrowserFrame = Omit<ServerOf<typeof BROWSER_LIVE_SERVER.FRAME>, "type">;

export interface CloudBrowserView {
  readonly phase: CloudBrowserPhase;
  readonly ended: BrowserLiveCloseReason | undefined;
  readonly painted: boolean;
  readonly page: Omit<ServerOf<typeof BROWSER_LIVE_SERVER.PAGE>, "type"> | undefined;
  readonly driver: Omit<ServerOf<typeof BROWSER_LIVE_SERVER.DRIVER>, "type"> | undefined;
  readonly takeoverRefused: boolean;
  readonly stepRefused: boolean;
}

export const OPENING_VIEW: CloudBrowserView = {
  phase: CLOUD_BROWSER_PHASE.CONNECTING,
  ended: undefined,
  painted: false,
  page: undefined,
  driver: undefined,
  takeoverRefused: false,
  stepRefused: false,
};

export interface CloudBrowserViewport {
  readonly width: number;
  readonly height: number;
}

export interface CloudBrowserLive {
  readonly views: Stream.Stream<CloudBrowserView>;
  resized(): void;
  takeOver(): void;
  handBack(): void;
  navigate(address: string): void;
  step(step: BrowserLiveHistory): void;
  input(message: InputMessage): void;
}

export type InputMessage = Extract<
  BrowserLiveClientMessage,
  {
    type:
      | typeof BROWSER_LIVE_CLIENT.MOUSE
      | typeof BROWSER_LIVE_CLIENT.WHEEL
      | typeof BROWSER_LIVE_CLIENT.KEY
      | typeof BROWSER_LIVE_CLIENT.TEXT;
  }
>;

type Arrival = { readonly text: string } | { readonly close: number };

class Dropped extends Data.TaggedError("Dropped") {}

class NotOpened extends Data.TaggedError("NotOpened") {}

const SOCKET_ENDING = {
  ENDED: "ended",
  DROPPED: "dropped",
} as const;

type SocketEnding = (typeof SOCKET_ENDING)[keyof typeof SOCKET_ENDING];

const RECONNECT_BACKOFF = Schedule.exponential(CLOUD_BROWSER_RECONNECT.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, CLOUD_BROWSER_RECONNECT.LONGEST)),
  ),
);

const REASON_BY_CODE: ReadonlyMap<number, BrowserLiveCloseReason> = new Map(
  Object.entries(BROWSER_LIVE_CLOSE_CODE).map(([reason, code]) => [
    code,
    reason as BrowserLiveCloseReason,
  ]),
);

const readServer = readEither(browserLiveServerMessageSchema, { excess: EXCESS_KEYS.DROP });

function serverMessage(text: string): BrowserLiveServerMessage | undefined {
  try {
    return Result.getOrUndefined(readServer(unparsedWire(JSON.parse(text))));
  } catch {
    return undefined;
  }
}

export function cloudBrowserLive(input: {
  readonly open: OpenBrowserLive;
  readonly target: BrowserLiveTarget;
  readonly viewport: () => CloudBrowserViewport | undefined;
  readonly onFrame: (frame: CloudBrowserFrame) => void;
}): CloudBrowserLive {
  const { open, target, viewport, onFrame } = input;
  const socket = MutableRef.make<BrowserLiveSocket | undefined>(undefined);
  const latest = MutableRef.make<CloudBrowserView>(OPENING_VIEW);

  const send = (message: BrowserLiveClientMessage) =>
    MutableRef.get(socket)?.send(JSON.stringify(message));
  const sendViewport = () => {
    const size = viewport();
    if (size === undefined || size.width < 1 || size.height < 1) return;
    send({
      type: BROWSER_LIVE_CLIENT.VIEWPORT,
      width: Math.round(size.width),
      height: Math.round(size.height),
    });
  };

  const views = Stream.unwrap(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<CloudBrowserView>(OPENING_VIEW);
      const set = (change: (view: CloudBrowserView) => CloudBrowserView) =>
        Effect.flatMap(SubscriptionRef.updateAndGet(state, change), (view) =>
          Effect.sync(() => MutableRef.set(latest, view)),
        );

      const heard = (message: BrowserLiveServerMessage) => {
        switch (message.type) {
          case BROWSER_LIVE_SERVER.FRAME: {
            const { type: _type, ...frame } = message;
            onFrame(frame);
            return MutableRef.get(latest).painted
              ? Effect.void
              : set((view) => ({ ...view, painted: true }));
          }
          case BROWSER_LIVE_SERVER.PAGE: {
            const { type: _type, ...page } = message;
            return set((view) => ({ ...view, page }));
          }
          case BROWSER_LIVE_SERVER.DRIVER: {
            const { type: _type, ...driver } = message;
            return set((view) => ({
              ...view,
              driver,
              takeoverRefused: false,
              stepRefused: false,
            }));
          }
          case BROWSER_LIVE_SERVER.REFUSED:
            if (message.reason === BROWSER_LIVE_REFUSAL.NOT_PERMITTED) {
              return set((view) => ({ ...view, takeoverRefused: true }));
            }
            return message.reason === BROWSER_LIVE_REFUSAL.HELD
              ? set((view) => ({ ...view, stepRefused: true }))
              : Effect.void;
          case BROWSER_LIVE_SERVER.CLOSED:
            return Effect.void;
        }
      };

      const attempt = Effect.scoped(
        Effect.gen(function* () {
          const arrivals = yield* Queue.unbounded<Arrival>();
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const opened = open(target, {
                message: (text) => Queue.offerUnsafe(arrivals, { text }),
                closed: (close) => Queue.offerUnsafe(arrivals, { close }),
              });
              MutableRef.set(socket, opened);
              return opened;
            }),
            (opened) =>
              Effect.sync(() => {
                if (MutableRef.get(socket) === opened) MutableRef.set(socket, undefined);
                opened.close();
              }),
          );
          yield* Effect.sync(sendViewport);
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.andThen(
                Effect.sleep(CLOUD_BROWSER_WATCHING_EVERY),
                Effect.sync(() => send({ type: BROWSER_LIVE_CLIENT.WATCHING })),
              ),
            ),
          );
          let reason: BrowserLiveCloseReason | undefined;
          let code: number | undefined;
          let live = false;
          yield* Stream.fromQueue(arrivals).pipe(
            Stream.takeUntil((arrival) => "close" in arrival),
            Stream.runForEach((arrival) => {
              if ("close" in arrival) {
                code = arrival.close;
                return Effect.void;
              }
              const message = serverMessage(arrival.text);
              if (message === undefined) return Effect.void;
              if (message.type === BROWSER_LIVE_SERVER.CLOSED) reason = message.reason;
              const opening = live
                ? Effect.void
                : set((view) => ({ ...view, phase: CLOUD_BROWSER_PHASE.LIVE, ended: undefined }));
              live = true;
              return Effect.andThen(opening, heard(message));
            }),
          );
          const ended = reason ?? (code === undefined ? undefined : REASON_BY_CODE.get(code));
          if (ended === BROWSER_LIVE_CLOSE_REASON.NOT_OPENED) {
            yield* set((view) => ({ ...view, phase: CLOUD_BROWSER_PHASE.CONNECTING }));
            return yield* Effect.fail(new NotOpened());
          }
          if (
            ended === BROWSER_LIVE_CLOSE_REASON.IDLE ||
            ended === BROWSER_LIVE_CLOSE_REASON.GONE
          ) {
            yield* set((view) => ({
              ...view,
              phase: CLOUD_BROWSER_PHASE.ENDED,
              ended,
              driver: undefined,
            }));
            return SOCKET_ENDING.ENDED;
          }
          yield* set((view) => ({
            ...view,
            phase: CLOUD_BROWSER_PHASE.RECONNECTING,
            driver: undefined,
          }));
          if (!live) return yield* Effect.fail(new Dropped());
          return SOCKET_ENDING.DROPPED;
        }),
      );

      yield* Effect.forkScoped(
        attempt.pipe(
          Effect.retry({
            schedule: Schedule.spaced(CLOUD_BROWSER_RECONNECT.NOT_OPENED_EVERY),
            while: (failure) => failure._tag === "NotOpened",
          }),
          Effect.retry({
            schedule: RECONNECT_BACKOFF,
            while: (failure) => failure._tag === "Dropped",
          }),
          Effect.repeat({
            schedule: Schedule.spaced(CLOUD_BROWSER_RECONNECT.FIRST),
            while: (ending: SocketEnding) => ending === SOCKET_ENDING.DROPPED,
          }),
          Effect.ignore,
        ),
      );
      return SubscriptionRef.changes(state);
    }),
  );

  return {
    views,
    resized: sendViewport,
    takeOver: () => send({ type: BROWSER_LIVE_CLIENT.TAKE_OVER }),
    handBack: () => send({ type: BROWSER_LIVE_CLIENT.HAND_BACK }),
    navigate: (address) => send({ type: BROWSER_LIVE_CLIENT.NAVIGATE, address }),
    step: (step) => send({ type: BROWSER_LIVE_CLIENT.HISTORY, step }),
    input: (message) => {
      if (MutableRef.get(latest).driver?.yours === true) send(message);
    },
  };
}
