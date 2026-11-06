import { Schema as EffectSchema } from "effect";
import { BROWSER_SHOWN_MAX_CHARS, isBrowserAddress } from "./browser-acts.js";
import { countedNumber } from "./service-wire.js";

export const BROWSER_LIVE = {
  PATH: "/api/browser/live",
  QUERY: { AGENT: "agent", TASK: "task", TAB: "tab" },
} as const;

export const BROWSER_LIVE_CLOSE_REASON = {
  IDLE: "idle",
  NOT_OPENED: "not-opened",
  GONE: "gone",
  UNAVAILABLE: "unavailable",
} as const;

export type BrowserLiveCloseReason =
  (typeof BROWSER_LIVE_CLOSE_REASON)[keyof typeof BROWSER_LIVE_CLOSE_REASON];

export const BROWSER_LIVE_CLOSE_CODE = {
  [BROWSER_LIVE_CLOSE_REASON.IDLE]: 4000,
  [BROWSER_LIVE_CLOSE_REASON.NOT_OPENED]: 4002,
  [BROWSER_LIVE_CLOSE_REASON.GONE]: 4003,
  [BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE]: 4005,
} as const satisfies Record<BrowserLiveCloseReason, number>;

export const BROWSER_LIVE_REFUSAL = {
  NOT_PERMITTED: "not-permitted",
  NOT_DRIVING: "not-driving",
  HELD: "held",
} as const;

export const BROWSER_LIVE_SERVER = {
  FRAME: "frame",
  PAGE: "page",
  DRIVER: "driver",
  REFUSED: "refused",
  CLOSED: "closed",
} as const;

export const BROWSER_LIVE_CLIENT = {
  TAKE_OVER: "take-over",
  HAND_BACK: "hand-back",
  VIEWPORT: "viewport",
  MOUSE: "mouse",
  WHEEL: "wheel",
  KEY: "key",
  TEXT: "text",
  NAVIGATE: "navigate",
  HISTORY: "history",
  WATCHING: "watching",
} as const;

export const BROWSER_LIVE_HISTORY = {
  BACK: "back",
  FORWARD: "forward",
  RELOAD: "reload",
} as const;

export type BrowserLiveHistory = (typeof BROWSER_LIVE_HISTORY)[keyof typeof BROWSER_LIVE_HISTORY];

export const BROWSER_LIVE_MOUSE_ACTION = { MOVE: "move", DOWN: "down", UP: "up" } as const;

export const BROWSER_LIVE_MOUSE_BUTTON = {
  NONE: "none",
  LEFT: "left",
  MIDDLE: "middle",
  RIGHT: "right",
} as const;

export const BROWSER_LIVE_KEY_ACTION = { DOWN: "down", UP: "up" } as const;

export const BROWSER_LIVE_MODIFIER = { ALT: 1, CONTROL: 2, META: 4, SHIFT: 8 } as const;

const BROWSER_LIVE_BOUNDS = {
  MAX_VIEWPORT: 10_000,
  MAX_WHEEL_DELTA: 10_000,
  MAX_KEY_CHARS: 64,
  MAX_TEXT_CHARS: 4_096,
  MAX_MODIFIERS: 15,
  MAX_BUTTONS: 31,
} as const;

const shownSchema = EffectSchema.String.check(EffectSchema.isMaxLength(BROWSER_SHOWN_MAX_CHARS));

const pixelsSchema = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 1, maximum: BROWSER_LIVE_BOUNDS.MAX_VIEWPORT }),
);

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

const browserLiveDriverSchema = EffectSchema.Struct({
  userId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
  heldUntil: countedNumber,
});

const browserLiveFrameSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.FRAME),
  data: EffectSchema.String,
  pageWidth: countedNumber,
  pageHeight: countedNumber,
});

const browserLivePageSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.PAGE),
  address: shownSchema,
  title: shownSchema,
  loading: EffectSchema.Boolean,
});

const browserLiveDriverChangeSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.DRIVER),
  driver: EffectSchema.NullOr(browserLiveDriverSchema),
  yours: EffectSchema.Boolean,
});

const browserLiveRefusedSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.REFUSED),
  reason: EffectSchema.Literals(Object.values(BROWSER_LIVE_REFUSAL)),
});

const browserLiveClosedSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_SERVER.CLOSED),
  reason: EffectSchema.Literals(Object.values(BROWSER_LIVE_CLOSE_REASON)),
});

/** @public */
export const browserLiveServerMessageSchema = EffectSchema.Union([
  browserLiveFrameSchema,
  browserLivePageSchema,
  browserLiveDriverChangeSchema,
  browserLiveRefusedSchema,
  browserLiveClosedSchema,
]);

export type BrowserLiveServerMessage = typeof browserLiveServerMessageSchema.Type;

const browserLiveTakeOverSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.TAKE_OVER),
});

const browserLiveHandBackSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.HAND_BACK),
});

const browserLiveViewportSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.VIEWPORT),
  width: pixelsSchema,
  height: pixelsSchema,
});

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

const browserLiveWheelSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.WHEEL),
  x: coordinateSchema,
  y: coordinateSchema,
  deltaX: wheelDeltaSchema,
  deltaY: wheelDeltaSchema,
  modifiers: modifiersSchema,
});

const browserLiveKeySchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.KEY),
  action: EffectSchema.Literals(Object.values(BROWSER_LIVE_KEY_ACTION)),
  key: keyNameSchema,
  code: keyNameSchema,
  keyCode: EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 0, maximum: 255 })),
  modifiers: modifiersSchema,
});

const browserLiveTextSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.TEXT),
  text: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(BROWSER_LIVE_BOUNDS.MAX_TEXT_CHARS),
  ),
});

const browserLiveNavigateSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.NAVIGATE),
  address: EffectSchema.String.check(EffectSchema.makeFilter(isBrowserAddress)),
});

const browserLiveHistorySchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.HISTORY),
  step: EffectSchema.Literals(Object.values(BROWSER_LIVE_HISTORY)),
});

const browserLiveWatchingSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_CLIENT.WATCHING),
});

export const browserLiveClientMessageSchema = EffectSchema.Union([
  browserLiveTakeOverSchema,
  browserLiveHandBackSchema,
  browserLiveViewportSchema,
  browserLiveMouseSchema,
  browserLiveWheelSchema,
  browserLiveKeySchema,
  browserLiveTextSchema,
  browserLiveNavigateSchema,
  browserLiveHistorySchema,
  browserLiveWatchingSchema,
]);

export type BrowserLiveClientMessage = typeof browserLiveClientMessageSchema.Type;
