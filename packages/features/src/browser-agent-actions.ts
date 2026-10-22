/**
 * browser-agent-actions.ts -- what an agent may do to a browser's tabs and what it hears back: the actions, a short sequence of them, each step's result, and the caps every result is held to.
 *
 * The vocabulary speaks of tabs and pages, never of where the browser runs.
 * A tab is named by its id, the DevTools protocol's
 * target id as `list` and `open` answer it; an action that names none acts
 * on the tab the action before it in the same sequence acted on, so a
 * sequence can open a tab and go on in it. An element is named by a ref a
 * snapshot printed, `e` and the node's backend id, which stays the same for
 * as long as the element is on the page, so a ref from one call is good in
 * the next. Addresses are http and https alone, as a Browser tab's are
 * (`browser-acts.ts`).
 *
 * A sequence runs in order and stops at its first failure, which says why in
 * words a model can act on; what ran before it stands, and the rest is
 * counted as skipped. Every text a result carries is cut to its cap, and a
 * screenshot is a JPEG no longer than {@link BROWSER_SCREENSHOT}'s side and
 * no larger than its bytes: the copy the model is shown. A run asked to keep
 * its screenshots answers each with a second copy beside it, the page at its
 * own size and good quality ({@link BROWSER_KEPT_SCREENSHOT}), which the
 * caller keeps for the transcript and never shows the model.
 *
 * A recording is no tab's: `record` starts recording whatever the browser
 * shows, tab after tab, and `stop_recording` stops it and answers the video
 * as the caller kept it, where the caller records at all; one that does not
 * fails both.
 */

import { describeWire } from "@luke/wire/effect";
import { Schema } from "effect";
import { BROWSER_SHOWN_MAX_CHARS, isBrowserAddress } from "./browser-acts.js";
import { CODING_AGENT_ATTACHMENT_TYPE, CODING_AGENT_BOUNDS } from "./coding-agent-wire.js";
import { CONVERSATION_MEDIA_TYPE, PICTURE_OMISSION } from "./conversation-picture-wire.js";

/** The actions an agent takes on a browser's tabs. */
export const BROWSER_AGENT_ACTION = {
  LIST: "list",
  OPEN: "open",
  NAVIGATE: "navigate",
  BACK: "back",
  FORWARD: "forward",
  CLICK: "click",
  TYPE: "type",
  SELECT: "select",
  KEY: "key",
  SCROLL: "scroll",
  WAIT: "wait",
  SCREENSHOT: "screenshot",
  SNAPSHOT: "snapshot",
  CONSOLE: "console",
  CLOSE: "close",
  /** Starts recording the browser as a video, whichever tab it shows. */
  RECORD: "record",
  /** Stops the recording and keeps it, as a video the transcript plays. */
  STOP_RECORDING: "stop_recording",
} as const;

export type BrowserAgentActionName =
  (typeof BROWSER_AGENT_ACTION)[keyof typeof BROWSER_AGENT_ACTION];

/** The caps an action and its result are held to. */
export const BROWSER_AGENT_LIMITS = {
  /** The most actions one call carries. */
  MAX_ACTIONS: 10,
  /** The most tabs `list` answers. */
  MAX_TABS: 50,
  /** The longest address or title a result carries, as a Browser tab is told one. */
  SHOWN_MAX_CHARS: BROWSER_SHOWN_MAX_CHARS,
  /** The longest text one `type` inserts. */
  TYPE_MAX_CHARS: 10_000,
  /** The longest option label or value one `select` names or answers. */
  OPTION_MAX_CHARS: 1_000,
  /** The longest snapshot text, its note that it was cut included. */
  SNAPSHOT_MAX_CHARS: 24_000,
  /** The longest name or value one element of a snapshot is printed with. */
  SNAPSHOT_NAME_MAX_CHARS: 160,
  /** The most console messages `console` answers, the latest. */
  CONSOLE_MAX_MESSAGES: 50,
  /** The longest console message a result carries. */
  CONSOLE_MESSAGE_MAX_CHARS: 1_000,
  /** The longest reason a failed step gives. */
  ERROR_MAX_CHARS: 1_000,
  /** How long an action may take, `wait` aside, before it fails as too slow. */
  ACTION_TIMEOUT_MS: 20_000,
  /** How long `wait` waits where it says nothing, and the longest it may say. */
  WAIT_DEFAULT_MS: 10_000,
  WAIT_MAX_MS: 30_000,
  /** The furthest one `scroll` moves, either way, in CSS pixels. */
  SCROLL_MAX_PIXELS: 100_000,
  /** The furthest a click lands from the page's corner, in CSS pixels. */
  POINT_MAX_PIXELS: 100_000,
  /** The longest a recording runs before it stops on its own, in seconds. */
  RECORDING_MAX_SECONDS: 120,
  /** How long `stop_recording` may take, since the video is encoded as it stops. */
  RECORDING_STOP_TIMEOUT_MS: 90_000,
  /** The longest caption a recording is kept with. */
  RECORDING_CAPTION_MAX_CHARS: 300,
} as const;

/**
 * How the model's copy of a screenshot is made: a JPEG of the visible page
 * downscaled to a longest side, at the first quality that fits the byte cap.
 */
export const BROWSER_SCREENSHOT = {
  MIME: "image/jpeg",
  /** The longest side of the picture, in pixels; a smaller page is never scaled up. */
  LONGEST_SIDE: 1_280,
  /** The JPEG qualities tried in order, until one fits. */
  QUALITIES: [70, 50, 30],
  /**
   * The most bytes the JPEG may hold. Note that this bounds what one picture
   * costs the model's context and each step's request, where a call may carry
   * ten of them and every later step of the turn carries them again; the
   * transcript keeps its own copy at full quality (`BROWSER_KEPT_SCREENSHOT`).
   */
  MAX_BYTES: 180_000,
} as const;

/** The longest base64 a screenshot's bytes are carried as. */
const SCREENSHOT_MAX_BASE64 = Math.ceil(BROWSER_SCREENSHOT.MAX_BYTES / 3) * 4;

/**
 * How the transcript's copy of a screenshot is made: the visible page at its
 * own pixels, up to a longest side, as a JPEG at the first quality or a PNG,
 * whichever is smaller, trying the lower qualities only where neither fits
 * the byte cap, which is the cap on an image a conversation's message
 * carries; none where nothing fits.
 */
export const BROWSER_KEPT_SCREENSHOT = {
  JPEG: CODING_AGENT_ATTACHMENT_TYPE.JPEG,
  PNG: CODING_AGENT_ATTACHMENT_TYPE.PNG,
  /** The longest side, in pixels: a page drawn at twice its CSS size fits whole; a smaller page is never scaled up. */
  LONGEST_SIDE: 2_560,
  /** The JPEG qualities tried in order, the PNG beside each, until the smaller of the two fits. */
  QUALITIES: [85, 70, 50],
  MAX_BYTES: CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES,
} as const;

/** The longest base64 a kept screenshot's bytes are carried as. */
const KEPT_SCREENSHOT_MAX_BASE64 = Math.ceil(BROWSER_KEPT_SCREENSHOT.MAX_BYTES / 3) * 4;

/** The keys `key` presses by name, with the code, Windows key code, and text a browser's own key event carries for each. */
export const BROWSER_KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9, text: "" },
  Escape: { code: "Escape", keyCode: 27, text: "" },
  Backspace: { code: "Backspace", keyCode: 8, text: "" },
  Delete: { code: "Delete", keyCode: 46, text: "" },
  Space: { code: "Space", keyCode: 32, text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38, text: "" },
  ArrowDown: { code: "ArrowDown", keyCode: 40, text: "" },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37, text: "" },
  ArrowRight: { code: "ArrowRight", keyCode: 39, text: "" },
  Home: { code: "Home", keyCode: 36, text: "" },
  End: { code: "End", keyCode: 35, text: "" },
  PageUp: { code: "PageUp", keyCode: 33, text: "" },
  PageDown: { code: "PageDown", keyCode: 34, text: "" },
} as const;

type BrowserKeyName = keyof typeof BROWSER_KEYS;

// SAFETY: `Object.keys` of an `as const` literal answers exactly its own keys.
const BROWSER_KEY_NAMES = Object.keys(BROWSER_KEYS) as readonly BrowserKeyName[];

/** The modifiers a key is pressed with. */
export const BROWSER_MODIFIER = {
  ALT: "alt",
  CONTROL: "control",
  META: "meta",
  SHIFT: "shift",
} as const;

/** The levels a console message is reported at. */
export const BROWSER_CONSOLE_LEVEL = {
  DEBUG: "debug",
  LOG: "log",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
} as const;

/** Whether a step ran or failed. */
export const BROWSER_STEP_STATUS = { DONE: "done", FAILED: "failed" } as const;

/** What the agent's pointer does at a point: moves there (a wheel turned over it), clicks, or types into what is there. */
export const BROWSER_CURSOR_KIND = { MOVE: "move", CLICK: "click", TYPE: "type" } as const;

export type BrowserCursorKind = (typeof BROWSER_CURSOR_KIND)[keyof typeof BROWSER_CURSOR_KIND];

/**
 * One move of the agent's pointer, reported just before its input reaches
 * the page: the tab, the point in the page's CSS pixels of its visible
 * area, what it does there, that area's size so a view drawn at another
 * scale can place it, and when, in epoch milliseconds. A point and a kind
 * are no page content.
 */
export interface BrowserCursorMove {
  readonly tab: string;
  readonly x: number;
  readonly y: number;
  readonly kind: BrowserCursorKind;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly at: number;
}

/** What starts a ref, before the element's backend node id. */
const REF_PREFIX = "e";

const REF_PATTERN = /^e\d{1,12}$/u;

/** The ref a snapshot prints for an element, by its backend node id. */
export function browserRefOf(backendNodeId: number): string {
  return `${REF_PREFIX}${backendNodeId}`;
}

/** The backend node id a ref names. */
export function backendNodeIdOf(ref: string): number {
  return Number(ref.slice(REF_PREFIX.length));
}

const tabId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));

const tab = Schema.optionalKey(
  describeWire(
    tabId,
    "The tab, by its id as list or open answered it; left out for the tab the action before it in this call acted on.",
  ),
);

const address = describeWire(
  Schema.String.check(
    Schema.makeFilter((value: string) => isBrowserAddress(value) || "an http or https address"),
  ),
  "An absolute http or https address, such as http://localhost:3000/ or https://example.com/.",
);

const ref = describeWire(
  Schema.String.check(Schema.isPattern(REF_PATTERN)),
  "An element, by the ref a snapshot printed beside it, such as e42.",
);

const coordinate = (axis: string) =>
  describeWire(
    Schema.Number.check(
      Schema.isBetween({ minimum: 0, maximum: BROWSER_AGENT_LIMITS.POINT_MAX_PIXELS }),
    ),
    `The point's ${axis}, in CSS pixels from the top-left corner of the visible page.`,
  );

const scrollDelta = (direction: string) =>
  Schema.optionalKey(
    describeWire(
      Schema.Number.check(
        Schema.isBetween({
          minimum: -BROWSER_AGENT_LIMITS.SCROLL_MAX_PIXELS,
          maximum: BROWSER_AGENT_LIMITS.SCROLL_MAX_PIXELS,
        }),
      ),
      `How far to scroll ${direction}, in CSS pixels; 0 when left out.`,
    ),
  );

const listAction = Schema.Struct({ action: Schema.Literal(BROWSER_AGENT_ACTION.LIST) });

const openAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.OPEN),
  url: address,
});

const navigateAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.NAVIGATE),
  tab,
  url: address,
});

/** An action that names a tab and nothing else. */
const tabAction = Schema.Struct({
  action: Schema.Literals([
    BROWSER_AGENT_ACTION.BACK,
    BROWSER_AGENT_ACTION.FORWARD,
    BROWSER_AGENT_ACTION.SCREENSHOT,
    BROWSER_AGENT_ACTION.SNAPSHOT,
    BROWSER_AGENT_ACTION.CONSOLE,
    BROWSER_AGENT_ACTION.CLOSE,
  ]),
  tab,
});

const clickAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.CLICK),
  tab,
  ref: Schema.optionalKey(ref),
  x: Schema.optionalKey(coordinate("distance from the left")),
  y: Schema.optionalKey(coordinate("distance from the top")),
}).check(
  Schema.makeFilter((click) =>
    (click.ref === undefined) !== (click.x === undefined && click.y === undefined) &&
    (click.x === undefined) === (click.y === undefined)
      ? true
      : "a click names a ref, or both x and y",
  ),
);

const typeAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.TYPE),
  tab,
  text: describeWire(
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(BROWSER_AGENT_LIMITS.TYPE_MAX_CHARS),
    ),
    "The text to type, as it is; a key such as Enter is its own key action.",
  ),
  ref: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isPattern(REF_PATTERN)),
      "The field to type into, by its ref; left out for the element that has the focus.",
    ),
  ),
});

const selectAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.SELECT),
  tab,
  ref: describeWire(
    Schema.String.check(Schema.isPattern(REF_PATTERN)),
    "The dropdown, a native select, by the ref a snapshot printed beside its combobox or listbox.",
  ),
  option: describeWire(
    Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.OPTION_MAX_CHARS)),
    "The option to choose: its label as the snapshot shows it, or else its value.",
  ),
});

const keyAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.KEY),
  tab,
  key: describeWire(
    Schema.Union([
      Schema.Literals(BROWSER_KEY_NAMES),
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1)),
    ]),
    "The key: a named one, or a single character such as a.",
  ),
  modifiers: Schema.optionalKey(
    describeWire(
      Schema.Array(Schema.Literals(Object.values(BROWSER_MODIFIER))).check(Schema.isMaxLength(4)),
      "The modifiers held down while it is pressed; none when left out.",
    ),
  ),
});

const scrollAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.SCROLL),
  tab,
  deltaX: scrollDelta("right, or left where negative"),
  deltaY: scrollDelta("down, or up where negative"),
  ref: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isPattern(REF_PATTERN)),
      "An element to scroll into view, by its ref, in place of a distance.",
    ),
  ),
}).check(
  Schema.makeFilter((scroll) =>
    (scroll.ref === undefined) !== (scroll.deltaX === undefined && scroll.deltaY === undefined)
      ? true
      : "a scroll names a ref, or a distance",
  ),
);

const waitAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.WAIT),
  tab,
  ref: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isPattern(REF_PATTERN)),
      "An element to wait for until it shows on the page, by its ref; left out to wait for the page to finish loading.",
    ),
  ),
  timeoutMs: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: BROWSER_AGENT_LIMITS.WAIT_MAX_MS })),
      `How long to wait, in milliseconds; ${BROWSER_AGENT_LIMITS.WAIT_DEFAULT_MS} when left out.`,
    ),
  ),
});

const recordAction = Schema.Struct({ action: Schema.Literal(BROWSER_AGENT_ACTION.RECORD) });

const stopRecordingAction = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.STOP_RECORDING),
  caption: Schema.optionalKey(
    describeWire(
      Schema.String.check(
        Schema.isNonEmpty(),
        Schema.isMaxLength(BROWSER_AGENT_LIMITS.RECORDING_CAPTION_MAX_CHARS),
        Schema.isPattern(/^[^\r\n]*$/u),
      ),
      "What the recording shows, in one line, which the transcript shows under it.",
    ),
  ),
});

/** One action on a browser's tabs. */
export const browserAgentActionSchema = Schema.Union([
  listAction,
  openAction,
  navigateAction,
  tabAction,
  clickAction,
  typeAction,
  selectAction,
  keyAction,
  scrollAction,
  waitAction,
  recordAction,
  stopRecordingAction,
]);

export type BrowserAgentAction = typeof browserAgentActionSchema.Type;

/** The actions one call carries, run in order. */
export const browserAgentActionsSchema = Schema.Array(browserAgentActionSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(BROWSER_AGENT_LIMITS.MAX_ACTIONS),
);

const shown = Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS));

const optionText = Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.OPTION_MAX_CHARS));

const done = Schema.Literal(BROWSER_STEP_STATUS.DONE);

/** A tab as a result names it: its id, address, and title. */
const browserAgentTabSchema = Schema.Struct({ tab: tabId, url: shown, title: shown });

const listed = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.LIST),
  status: done,
  tabs: Schema.Array(browserAgentTabSchema).check(
    Schema.isMaxLength(BROWSER_AGENT_LIMITS.MAX_TABS),
  ),
});

/** A step that answers only the tab it acted on. */
const acted = Schema.Struct({
  action: Schema.Literals([
    BROWSER_AGENT_ACTION.OPEN,
    BROWSER_AGENT_ACTION.NAVIGATE,
    BROWSER_AGENT_ACTION.BACK,
    BROWSER_AGENT_ACTION.FORWARD,
    BROWSER_AGENT_ACTION.CLICK,
    BROWSER_AGENT_ACTION.TYPE,
    BROWSER_AGENT_ACTION.KEY,
    BROWSER_AGENT_ACTION.SCROLL,
    BROWSER_AGENT_ACTION.WAIT,
    BROWSER_AGENT_ACTION.CLOSE,
  ]),
  status: done,
  tab: tabId,
});

/** A choice made in a dropdown: the option now selected, by its label and its value. */
const selected = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.SELECT),
  status: done,
  tab: tabId,
  label: optionText,
  value: optionText,
});

/** A screenshot's picture: the JPEG's base64 and its size in pixels. */
const browserScreenshotSchema = Schema.Struct({
  mime: Schema.Literal(BROWSER_SCREENSHOT.MIME),
  data: Schema.String.check(Schema.isMaxLength(SCREENSHOT_MAX_BASE64)),
  width: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: BROWSER_SCREENSHOT.LONGEST_SIDE }),
  ),
  height: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: BROWSER_SCREENSHOT.LONGEST_SIDE }),
  ),
});

/** @public */
export type BrowserScreenshot = typeof browserScreenshotSchema.Type;

/** A screenshot's copy for the transcript: a JPEG's or a PNG's base64 and its size in pixels. */
const browserKeptScreenshotSchema = Schema.Struct({
  mime: Schema.Literals([BROWSER_KEPT_SCREENSHOT.JPEG, BROWSER_KEPT_SCREENSHOT.PNG]),
  data: Schema.String.check(Schema.isMaxLength(KEPT_SCREENSHOT_MAX_BASE64)),
  width: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: BROWSER_KEPT_SCREENSHOT.LONGEST_SIDE }),
  ),
  height: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: BROWSER_KEPT_SCREENSHOT.LONGEST_SIDE }),
  ),
});

export type BrowserKeptScreenshot = typeof browserKeptScreenshotSchema.Type;

const screenshotted = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.SCREENSHOT),
  status: done,
  tab: tabId,
  image: browserScreenshotSchema,
  /** The transcript's copy, where the run was asked to keep its screenshots and one fit its cap. */
  kept: Schema.optionalKey(browserKeptScreenshotSchema),
});

const snapshotted = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.SNAPSHOT),
  status: done,
  tab: tabId,
  url: shown,
  title: shown,
  /** The page's accessibility tree, an element a line, each element an agent can act on with its ref. */
  text: Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.SNAPSHOT_MAX_CHARS)),
  /** Whether the tree was longer than the cap and its end was left out. */
  truncated: Schema.Boolean,
});

/** One console message: its level and its text. */
const browserConsoleMessageSchema = Schema.Struct({
  level: Schema.Literals(Object.values(BROWSER_CONSOLE_LEVEL)),
  text: Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.CONSOLE_MESSAGE_MAX_CHARS)),
});

export type BrowserConsoleMessage = typeof browserConsoleMessageSchema.Type;

const consoled = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.CONSOLE),
  status: done,
  tab: tabId,
  /** The latest messages, oldest first. */
  messages: Schema.Array(browserConsoleMessageSchema).check(
    Schema.isMaxLength(BROWSER_AGENT_LIMITS.CONSOLE_MAX_MESSAGES),
  ),
  /** Whether older messages were left out. */
  truncated: Schema.Boolean,
});

/** A recording started: how long it runs at most before it stops on its own. */
const recordingStarted = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.RECORD),
  status: done,
  maxSeconds: Schema.Int,
});

/** A recording stopped: how long it ran, its caption, and the video as the transcript kept it, or why it was not kept and its size. */
const recordingStopped = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.STOP_RECORDING),
  status: done,
  seconds: Schema.Number,
  caption: Schema.optionalKey(Schema.String),
  picture: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      mediaType: Schema.Literal(CONVERSATION_MEDIA_TYPE.WEBM),
      width: Schema.Int,
      height: Schema.Int,
      byteCount: Schema.Int,
    }),
  ),
  omitted: Schema.optionalKey(Schema.Literals(Object.values(PICTURE_OMISSION))),
  byteCount: Schema.optionalKey(Schema.Int),
});

export type BrowserRecordingStopped = typeof recordingStopped.Type;

/** A step that failed: the tab it was on where it named one, and why, in words a model can act on. */
const failed = Schema.Struct({
  action: Schema.Literals(Object.values(BROWSER_AGENT_ACTION)),
  status: Schema.Literal(BROWSER_STEP_STATUS.FAILED),
  tab: Schema.optionalKey(tabId),
  error: Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.ERROR_MAX_CHARS)),
});

/** One step of a sequence, as it ran. @public */
export const browserAgentStepSchema = Schema.Union([
  listed,
  acted,
  selected,
  screenshotted,
  snapshotted,
  consoled,
  recordingStarted,
  recordingStopped,
  failed,
]);

export type BrowserAgentStep = typeof browserAgentStepSchema.Type;

/** A sequence as it ran: each step up to and with the first that failed, and how many after it never ran. @public */
export const browserAgentRunSchema = Schema.Struct({
  steps: Schema.Array(browserAgentStepSchema),
  skipped: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: BROWSER_AGENT_LIMITS.MAX_ACTIONS }),
  ),
});

export type BrowserAgentRun = typeof browserAgentRunSchema.Type;

/** A text cut to a cap, its end marked where it was cut. */
export function cutBrowserText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
