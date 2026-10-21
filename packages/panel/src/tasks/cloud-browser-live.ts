/**
 * cloud-browser-live.ts -- one cloud Browser tab's live view as the panel holds it: its socket opened through the window's shell, read, sized, and opened again, and what its member sends on it.
 *
 * The socket (`@luke/features/browser-live-wire`) is opened through the
 * shell's door (`AppPlatform.openBrowserLive`): the desktop's from its host
 * under the account's bearer, the web's from its own page under the session
 * cookie. Everything past the door is here, the same on both. A socket is
 * sized with the viewport the pane draws at as soon as it opens, again each
 * time the pane resizes, and at least once a minute while it stands, which
 * is what keeps the relay from closing it as idle. A socket that drops is
 * opened again after a wait that doubles to thirty seconds and starts over
 * once a socket has been heard on; one whose agent has not opened its
 * sandbox is asked after every five seconds; and one the relay closed as
 * idle or gone stays closed until the pane is shown again or Watch again is
 * pressed, which opens a new view. Each frame is handed to the pane to draw and let go:
 * neither a frame, an address, nor a title is kept past the view, traced, or
 * counted (root `AGENTS.md`'s cloud browser line). Input is sent only while
 * the member drives the tab.
 */

import type { BrowserLiveTarget } from "@luke/features/browser-live-acts";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_CODE,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_REFUSAL,
  BROWSER_LIVE_SERVER,
  type BrowserLiveClientMessage,
  type BrowserLiveCloseReason,
  type BrowserLiveServerMessage,
  browserLiveServerMessageSchema,
} from "@luke/features/browser-live-wire";
import { EXCESS_KEYS, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
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

/** What a shell's door tells the panel of one socket: each text frame, and its close, once and last. */
export interface BrowserLiveListener {
  message(text: string): void;
  closed(code: number): void;
}

/** One open socket, as the panel sends on it and lets it go. */
export interface BrowserLiveSocket {
  /** Sends one text frame; one sent before the socket opened is held for it. */
  send(text: string): void;
  /** Closes the socket; the listener hears nothing after. */
  close(): void;
}

/** Opens one tab's live view socket through the window's shell. */
export type OpenBrowserLive = (
  target: BrowserLiveTarget,
  listener: BrowserLiveListener,
) => BrowserLiveSocket;

/** How long the view waits before it opens its socket again. */
const CLOUD_BROWSER_RECONNECT = {
  /** The first wait after a drop, doubling on each drop before a socket is heard on again. */
  FIRST: Duration.seconds(1),
  /** The longest wait after a drop. */
  LONGEST: Duration.seconds(30),
  /** The wait between asks while the agent has not opened its sandbox. */
  NOT_OPENED_EVERY: Duration.seconds(5),
} as const;

/** How often the viewport is sent again while the socket stands, well inside the relay's idle bound. */
const CLOUD_BROWSER_VIEWPORT_EVERY = Duration.minutes(1);

/** Where a view stands. */
export const CLOUD_BROWSER_PHASE = {
  /** The first socket is opening, or the agent's sandbox is. */
  CONNECTING: "connecting",
  /** A socket stands and has been heard on. */
  LIVE: "live",
  /** The socket dropped, and another opens after a wait. */
  RECONNECTING: "reconnecting",
  /** The relay closed it as idle or gone; a new view opens it again. */
  ENDED: "ended",
} as const;

type CloudBrowserPhase = (typeof CLOUD_BROWSER_PHASE)[keyof typeof CLOUD_BROWSER_PHASE];

type ServerOf<Type extends BrowserLiveServerMessage["type"]> = Extract<
  BrowserLiveServerMessage,
  { type: Type }
>;

/** One frame of the page, which the pane draws and lets go. */
export type CloudBrowserFrame = Omit<ServerOf<typeof BROWSER_LIVE_SERVER.FRAME>, "type">;

/** A view as the pane draws it. */
export interface CloudBrowserView {
  readonly phase: CloudBrowserPhase;
  /** Why the relay ended the view, once it did. */
  readonly ended: BrowserLiveCloseReason | undefined;
  /** Whether a frame has arrived since the view opened, before which the pane says it waits for the page. */
  readonly painted: boolean;
  /** The page as it last stood: its address, title, and whether it is loading. */
  readonly page: Omit<ServerOf<typeof BROWSER_LIVE_SERVER.PAGE>, "type"> | undefined;
  /** Who drives the tab, as the relay last said; none before it said. */
  readonly driver: Omit<ServerOf<typeof BROWSER_LIVE_SERVER.DRIVER>, "type"> | undefined;
  /** Whether the relay refused a takeover as this member's not to take. */
  readonly takeoverRefused: boolean;
}

/** A view before its first socket opens. */
export const OPENING_VIEW: CloudBrowserView = {
  phase: CLOUD_BROWSER_PHASE.CONNECTING,
  ended: undefined,
  painted: false,
  page: undefined,
  driver: undefined,
  takeoverRefused: false,
};

/** A size in the pane's own pixels. */
export interface CloudBrowserViewport {
  readonly width: number;
  readonly height: number;
}

/** One view of one tab, and what its member sends on it. */
export interface CloudBrowserLive {
  /** The view's life: opened, read, opened again after a drop, its state each time it changes; it ends with its stream. */
  readonly views: Stream.Stream<CloudBrowserView>;
  /** Sends the viewport as it now stands, as the pane does on each resize. */
  resized(): void;
  /** Takes the tab over, or moves the member's own takeover on. */
  takeOver(): void;
  /** Hands the tab back to its agent. */
  handBack(): void;
  /** Sends a mouse, wheel, key, or text message, only while the member drives the tab. */
  input(message: InputMessage): void;
}

/** The messages that drive the page, which only the member driving the tab sends. */
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

/** What arrives on a socket's queue: a text frame, or its close, last. */
type Arrival = { readonly text: string } | { readonly close: number };

/** The socket dropped, or never opened, before it was heard on. */
class Dropped extends Data.TaggedError("Dropped") {}

/** The agent has not opened its sandbox yet. */
class NotOpened extends Data.TaggedError("NotOpened") {}

/** How one socket's life ended, where the view does not try again on its own schedule. */
const SOCKET_ENDING = {
  /** The relay ended the view. */
  ENDED: "ended",
  /** The socket had been heard on, and dropped: the view opens again, its wait started over. */
  DROPPED: "dropped",
} as const;

type SocketEnding = (typeof SOCKET_ENDING)[keyof typeof SOCKET_ENDING];

const RECONNECT_BACKOFF = Schedule.exponential(CLOUD_BROWSER_RECONNECT.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, CLOUD_BROWSER_RECONNECT.LONGEST)),
  ),
);

/** The reason each of the relay's close codes says. */
const REASON_BY_CODE: ReadonlyMap<number, BrowserLiveCloseReason> = new Map(
  Object.entries(BROWSER_LIVE_CLOSE_CODE).map(([reason, code]) => [
    code,
    // SAFETY: the entries' keys are the record's own, every one a close reason.
    reason as BrowserLiveCloseReason,
  ]),
);

const readServer = readEither(browserLiveServerMessageSchema, { excess: EXCESS_KEYS.DROP });

/** A text frame as the relay's own message, or nothing where it is not JSON this build reads. */
function serverMessage(text: string): BrowserLiveServerMessage | undefined {
  try {
    return Result.getOrUndefined(readServer(unparsedWire(JSON.parse(text))));
  } catch {
    return undefined;
  }
}

/**
 * One tab's live view over the shell's door. `viewport` is the size the pane
 * draws the page at now, none before it is laid out; `onFrame` draws a frame.
 */
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

      /** One message the relay sent, taken into the view; a frame is drawn and let go. */
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
            return set((view) => ({ ...view, driver, takeoverRefused: false }));
          }
          case BROWSER_LIVE_SERVER.REFUSED:
            return message.reason === BROWSER_LIVE_REFUSAL.NOT_PERMITTED
              ? set((view) => ({ ...view, takeoverRefused: true }))
              : Effect.void;
          case BROWSER_LIVE_SERVER.CLOSED:
            return Effect.void;
        }
      };

      /**
       * One socket's life: opened, sized, read until it closes, and its close
       * read as how the view stands. A drop before it was heard on fails, for
       * the backoff to wait on; one after answers dropped, so the wait starts
       * over; an agent with no sandbox yet fails as not opened.
       */
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
          // The viewport goes as the socket opens, then on the beat.
          yield* Effect.forkScoped(
            Effect.repeat(Effect.sync(sendViewport), Schedule.spaced(CLOUD_BROWSER_VIEWPORT_EVERY)),
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
    input: (message) => {
      if (MutableRef.get(latest).driver?.yours === true) send(message);
    },
  };
}
