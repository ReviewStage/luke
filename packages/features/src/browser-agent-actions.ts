import { describeWire } from "@repo/wire/effect";
import { Schema } from "effect";
import { AGENT_ATTACHMENT_TYPE, AGENT_BOUNDS } from "./agent-wire.js";
import { BROWSER_SHOWN_MAX_CHARS, isBrowserAddress } from "./browser-acts.js";
import { CONVERSATION_MEDIA_TYPE, PICTURE_OMISSION } from "./conversation-picture-wire.js";

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
  RECORD: "record",
  STOP_RECORDING: "stop_recording",
} as const;

export type BrowserAgentActionName =
  (typeof BROWSER_AGENT_ACTION)[keyof typeof BROWSER_AGENT_ACTION];

export const BROWSER_AGENT_LIMITS = {
  MAX_ACTIONS: 10,
  MAX_TABS: 50,
  SHOWN_MAX_CHARS: BROWSER_SHOWN_MAX_CHARS,
  TYPE_MAX_CHARS: 10_000,
  OPTION_MAX_CHARS: 1_000,
  SNAPSHOT_MAX_CHARS: 24_000,
  SNAPSHOT_NAME_MAX_CHARS: 160,
  CONSOLE_MAX_MESSAGES: 50,
  CONSOLE_MESSAGE_MAX_CHARS: 1_000,
  ERROR_MAX_CHARS: 1_000,
  ACTION_TIMEOUT_MS: 20_000,
  WAIT_DEFAULT_MS: 10_000,
  WAIT_MAX_MS: 30_000,
  SCROLL_MAX_PIXELS: 100_000,
  POINT_MAX_PIXELS: 100_000,
  RECORDING_MAX_SECONDS: 120,
  RECORDING_STOP_TIMEOUT_MS: 90_000,
  RECORDING_CAPTION_MAX_CHARS: 300,
} as const;

export const BROWSER_SCREENSHOT = {
  MIME: "image/jpeg",
  LONGEST_SIDE: 1_280,
  QUALITIES: [70, 50, 30],
  MAX_BYTES: 180_000,
} as const;

const SCREENSHOT_MAX_BASE64 = Math.ceil(BROWSER_SCREENSHOT.MAX_BYTES / 3) * 4;

export const BROWSER_KEPT_SCREENSHOT = {
  JPEG: AGENT_ATTACHMENT_TYPE.JPEG,
  PNG: AGENT_ATTACHMENT_TYPE.PNG,
  LONGEST_SIDE: 2_560,
  QUALITIES: [85, 70, 50],
  MAX_BYTES: AGENT_BOUNDS.MAX_IMAGE_BYTES,
} as const;

const KEPT_SCREENSHOT_MAX_BASE64 = Math.ceil(BROWSER_KEPT_SCREENSHOT.MAX_BYTES / 3) * 4;

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

const BROWSER_KEY_NAMES = Object.keys(BROWSER_KEYS) as readonly BrowserKeyName[];

export const BROWSER_MODIFIER = {
  ALT: "alt",
  CONTROL: "control",
  META: "meta",
  SHIFT: "shift",
} as const;

export const BROWSER_CONSOLE_LEVEL = {
  DEBUG: "debug",
  LOG: "log",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
} as const;

export const BROWSER_STEP_STATUS = { DONE: "done", FAILED: "failed" } as const;

export const BROWSER_CURSOR_KIND = { MOVE: "move", CLICK: "click", TYPE: "type" } as const;

export type BrowserCursorKind = (typeof BROWSER_CURSOR_KIND)[keyof typeof BROWSER_CURSOR_KIND];

export interface BrowserCursorMove {
  readonly tab: string;
  readonly x: number;
  readonly y: number;
  readonly kind: BrowserCursorKind;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly at: number;
}

const REF_PREFIX = "e";

const REF_PATTERN = /^e\d{1,12}$/u;

export function browserRefOf(backendNodeId: number): string {
  return `${REF_PREFIX}${backendNodeId}`;
}

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

export const browserAgentActionsSchema = Schema.Array(browserAgentActionSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(BROWSER_AGENT_LIMITS.MAX_ACTIONS),
);

const shown = Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS));

const optionText = Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.OPTION_MAX_CHARS));

const done = Schema.Literal(BROWSER_STEP_STATUS.DONE);

const browserAgentTabSchema = Schema.Struct({ tab: tabId, url: shown, title: shown });

const listed = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.LIST),
  status: done,
  tabs: Schema.Array(browserAgentTabSchema).check(
    Schema.isMaxLength(BROWSER_AGENT_LIMITS.MAX_TABS),
  ),
});

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

const selected = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.SELECT),
  status: done,
  tab: tabId,
  label: optionText,
  value: optionText,
});

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
  kept: Schema.optionalKey(browserKeptScreenshotSchema),
});

const snapshotted = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.SNAPSHOT),
  status: done,
  tab: tabId,
  url: shown,
  title: shown,
  text: Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.SNAPSHOT_MAX_CHARS)),
  truncated: Schema.Boolean,
});

const browserConsoleMessageSchema = Schema.Struct({
  level: Schema.Literals(Object.values(BROWSER_CONSOLE_LEVEL)),
  text: Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.CONSOLE_MESSAGE_MAX_CHARS)),
});

export type BrowserConsoleMessage = typeof browserConsoleMessageSchema.Type;

const consoled = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.CONSOLE),
  status: done,
  tab: tabId,
  messages: Schema.Array(browserConsoleMessageSchema).check(
    Schema.isMaxLength(BROWSER_AGENT_LIMITS.CONSOLE_MAX_MESSAGES),
  ),
  truncated: Schema.Boolean,
});

const recordingStarted = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.RECORD),
  status: done,
  maxSeconds: Schema.Int,
});

const recordingStopped = Schema.Struct({
  action: Schema.Literal(BROWSER_AGENT_ACTION.STOP_RECORDING),
  status: done,
  seconds: Schema.Number,
  caption: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
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

const failed = Schema.Struct({
  action: Schema.Literals(Object.values(BROWSER_AGENT_ACTION)),
  status: Schema.Literal(BROWSER_STEP_STATUS.FAILED),
  tab: Schema.optionalKey(tabId),
  error: Schema.String.check(Schema.isMaxLength(BROWSER_AGENT_LIMITS.ERROR_MAX_CHARS)),
});

/** @public */
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

/** @public */
export const browserAgentRunSchema = Schema.Struct({
  steps: Schema.Array(browserAgentStepSchema),
  skipped: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: BROWSER_AGENT_LIMITS.MAX_ACTIONS }),
  ),
});

export type BrowserAgentRun = typeof browserAgentRunSchema.Type;

export function cutBrowserText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
