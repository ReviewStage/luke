/**
 * browser-live-wire.ts -- a live view of one Browser tab in an agent's cloud browser, and its takeover: the socket a member's panel opens to the service, and the messages each side sends on it.
 *
 * One socket is one tab of one task (`agent-browser-tab-wire.ts`'s tab, by
 * its id). The desktop opens it from its main process under the account's
 * bearer and with no `Origin`, as it opens a terminal; the web app opens it
 * from the deployment's own page, where the browser carries the session
 * cookie and names the page's origin, which the service holds to its own.
 * An upgrade from anyone who cannot read the tab is refused before a socket
 * stands.
 *
 * The service sends the tab's page as JPEG frames, at most a few a second
 * and no larger than a laptop's screen, and its address, title, and loading
 * state as they change; who drives the tab as that changes; and, last, why
 * it closed. The panel sends the size it draws the frames at, and while its
 * member holds the takeover, the mouse, wheel, and keys at that size, which
 * the service maps onto the page. Taking over and handing back go over the
 * same socket: a takeover lapses `BROWSER_TAKEOVER_HOLD_MS` past the
 * member's last input, as the tabs contract's does, and a socket that
 * closes hands the tab back. Every message the panel sends counts as
 * someone watching; a panel shown on screen sends its viewport at least
 * once a minute, and a socket nobody sends on closes as idle.
 *
 * Every message is a JSON text frame. A message the panel sends refuses a
 * key it did not name; one the service sends is read dropping any key a
 * newer service added. Neither a frame, an address, nor a title is ever
 * logged, traced, counted, or kept in a fixture (root `AGENTS.md`'s cloud
 * browser line).
 */

import { Schema as EffectSchema } from "effect";
import { BROWSER_SHOWN_MAX_CHARS } from "./browser-acts.js";
import { countedNumber } from "./service-wire.js";

/** The socket's path, and the query naming the task and the tab. */
export const BROWSER_LIVE = {
  PATH: "/api/browser/live",
  QUERY: { TASK: "task", TAB: "tab" },
} as const;

/** Why the service closed a socket, which the panel reads as the tab's state. */
export const BROWSER_LIVE_CLOSE_REASON = {
  /** Nobody sent anything on the socket for the idle bound; the panel reconnects when shown or clicked. */
  IDLE: "idle",
  /** The agent has not opened its sandbox yet. */
  NOT_OPENED: "not-opened",
  /** The tab closed, its browser no longer holds it, or the member no longer reaches it. */
  GONE: "gone",
  /** The agent's browser or the service's store could not be reached; the panel may try again. */
  UNAVAILABLE: "unavailable",
} as const;

export type BrowserLiveCloseReason =
  (typeof BROWSER_LIVE_CLOSE_REASON)[keyof typeof BROWSER_LIVE_CLOSE_REASON];

/** The WebSocket close code each reason closes with, after its `closed` message. */
export const BROWSER_LIVE_CLOSE_CODE = {
  [BROWSER_LIVE_CLOSE_REASON.IDLE]: 4000,
  [BROWSER_LIVE_CLOSE_REASON.NOT_OPENED]: 4002,
  [BROWSER_LIVE_CLOSE_REASON.GONE]: 4003,
  [BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE]: 4005,
} as const satisfies Record<BrowserLiveCloseReason, number>;

/** Why the service refused what the panel asked. */
export const BROWSER_LIVE_REFUSAL = {
  /** Driving the tab is its agent's starter's alone: an agent on the starter's own GitHub token. */
  NOT_PERMITTED: "not-permitted",
  /** Input arrived while the member does not hold the takeover. */
  NOT_DRIVING: "not-driving",
} as const;

/** The messages the service sends, by type. */
export const BROWSER_LIVE_SERVER = {
  FRAME: "frame",
  PAGE: "page",
  DRIVER: "driver",
  REFUSED: "refused",
  CLOSED: "closed",
} as const;

/** The messages the panel sends, by type. */
export const BROWSER_LIVE_CLIENT = {
  TAKE_OVER: "take-over",
  HAND_BACK: "hand-back",
  VIEWPORT: "viewport",
  MOUSE: "mouse",
  WHEEL: "wheel",
  KEY: "key",
  TEXT: "text",
} as const;

/** What a mouse message does. */
export const BROWSER_LIVE_MOUSE_ACTION = { MOVE: "move", DOWN: "down", UP: "up" } as const;

/** Which button a mouse message names. */
export const BROWSER_LIVE_MOUSE_BUTTON = {
  NONE: "none",
  LEFT: "left",
  MIDDLE: "middle",
  RIGHT: "right",
} as const;

/** What a key message does. */
export const BROWSER_LIVE_KEY_ACTION = { DOWN: "down", UP: "up" } as const;

/** The modifier keys held, as bits of one number, as the DevTools protocol reads them. */
export const BROWSER_LIVE_MODIFIER = { ALT: 1, CONTROL: 2, META: 4, SHIFT: 8 } as const;

const BROWSER_LIVE_BOUNDS = {
  /** The widest and tallest a panel draws the frames, in its own pixels. */
  MAX_VIEWPORT: 10_000,
  /** The most a wheel message scrolls by, either way, in pixels. */
  MAX_WHEEL_DELTA: 10_000,
  /** The most characters of a key's name or code, as a `KeyboardEvent` spells them. */
  MAX_KEY_CHARS: 64,
  /** The most characters one text message inserts: a paste is sent in pieces. */
  MAX_TEXT_CHARS: 4_096,
  /** Every modifier bit set. */
  MAX_MODIFIERS: 15,
  /** Every mouse button bit set. */
  MAX_BUTTONS: 31,
} as const;

const shownSchema = EffectSchema.String.check(EffectSchema.isMaxLength(BROWSER_SHOWN_MAX_CHARS));

const pixelsSchema = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 1, maximum: BROWSER_LIVE_BOUNDS.MAX_VIEWPORT }),
);

/** A point in the panel's own pixels, at the size its viewport message gave. */
const coordinateSchema = EffectSchema.Finite.check(
  EffectSchema.isBetween({ minimum: 0, maximum: BROWSER_LIVE_BOUNDS.MAX_VIEWPORT }),
);

const wheelDeltaSchema = EffectSchema.Finite.check(
  EffectSchema.isBetween({
    minimum: -BROWSER_LIVE_BOUNDS.MAX_WHEEL_DELTA,
    maximum: BROWSER_LIVE_BOUNDS.MAX_WHEEL_DELTA,
  }),
);

const modifiersSchema = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 0, maximum: BROWSER_LIVE_BOUNDS.MAX_MODIFIERS }),
);

const keyNameSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(BROWSER_LIVE_BOUNDS.MAX_KEY_CHARS),
);

/** The member driving the tab, and the epoch milliseconds their takeover lapses at unless they act again. */
const browserLiveDriverSchema = EffectSchema.Struct({
  userId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
  heldUntil: countedNumber,
});

/** One frame of the page: a base64 JPEG, and the page's own size in CSS pixels, which the frame shows whole. */
const browserLiveFrameSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.FRAME),
  data: EffectSchema.String,
  pageWidth: countedNumber,
  pageHeight: countedNumber,
});

/** The tab's page as it now stands: its address, its title, and whether it is loading. */
const browserLivePageSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.PAGE),
  address: shownSchema,
  title: shownSchema,
  loading: EffectSchema.Boolean,
});

/** Who drives the tab now: null while its agent has it; `yours` where it is this socket's member. */
const browserLiveDriverChangeSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.DRIVER),
  driver: EffectSchema.NullOr(browserLiveDriverSchema),
  yours: EffectSchema.Boolean,
});

/** What the panel asked was refused, and why. */
const browserLiveRefusedSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.REFUSED),
  reason: EffectSchema.Literals(Object.values(BROWSER_LIVE_REFUSAL)),
});

/** The socket is closing, and why; the close code that follows says the same. */
const browserLiveClosedSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.CLOSED),
  reason: EffectSchema.Literals(Object.values(BROWSER_LIVE_CLOSE_REASON)),
});

/**
 * Every message the service sends.
 *
 * @public Read by the panel's cloud Browser tab, which lands above the relay.
 */
export const browserLiveServerMessageSchema = EffectSchema.Union([
  browserLiveFrameSchema,
  browserLivePageSchema,
  browserLiveDriverChangeSchema,
  browserLiveRefusedSchema,
  browserLiveClosedSchema,
]);

export type BrowserLiveServerMessage = typeof browserLiveServerMessageSchema.Type;

/** The member takes the tab over, or moves their own takeover on. */
const browserLiveTakeOverSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.TAKE_OVER),
});

/** The member hands the tab back to its agent. */
const browserLiveHandBackSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.HAND_BACK),
});

/** The size the panel draws the frames at, in its own pixels, which every point it sends is in. */
const browserLiveViewportSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.VIEWPORT),
  width: pixelsSchema,
  height: pixelsSchema,
});

/** The mouse moved, or a button went down or up, at a point; `buttons` are those held, as bits (left 1, right 2, middle 4). */
const browserLiveMouseSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.MOUSE),
  action: EffectSchema.Literals(Object.values(BROWSER_LIVE_MOUSE_ACTION)),
  x: coordinateSchema,
  y: coordinateSchema,
  button: EffectSchema.Literals(Object.values(BROWSER_LIVE_MOUSE_BUTTON)),
  buttons: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: 0, maximum: BROWSER_LIVE_BOUNDS.MAX_BUTTONS }),
  ),
  clickCount: EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 0, maximum: 3 })),
  modifiers: modifiersSchema,
});

/** The wheel turned at a point, by the pixels given. */
const browserLiveWheelSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.WHEEL),
  x: coordinateSchema,
  y: coordinateSchema,
  deltaX: wheelDeltaSchema,
  deltaY: wheelDeltaSchema,
  modifiers: modifiersSchema,
});

/** A key went down or up, named as a `KeyboardEvent` names it, with its legacy key code where it has one. */
const browserLiveKeySchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.KEY),
  action: EffectSchema.Literals(Object.values(BROWSER_LIVE_KEY_ACTION)),
  key: keyNameSchema,
  code: keyNameSchema,
  keyCode: EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 0, maximum: 255 })),
  modifiers: modifiersSchema,
});

/** Text to insert where the page's focus is, as a paste or a finished composition does. */
const browserLiveTextSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.TEXT),
  text: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(BROWSER_LIVE_BOUNDS.MAX_TEXT_CHARS),
  ),
});

/** Every message the panel sends. */
export const browserLiveClientMessageSchema = EffectSchema.Union([
  browserLiveTakeOverSchema,
  browserLiveHandBackSchema,
  browserLiveViewportSchema,
  browserLiveMouseSchema,
  browserLiveWheelSchema,
  browserLiveKeySchema,
  browserLiveTextSchema,
]);

export type BrowserLiveClientMessage = typeof browserLiveClientMessageSchema.Type;
