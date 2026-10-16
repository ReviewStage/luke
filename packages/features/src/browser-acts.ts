/**
 * browser-acts.ts -- what a Browser tab says to the main process and hears back: the address a typed line opens, its acts' payloads, and how its page stands.
 *
 * A Browser tab draws one web page in a view main owns over the panel
 * (`docs/proposals/browser-tab.md`), so the tab names its view by an id it
 * made and main keeps the page. The acts carry an address, a step, and where
 * the view stands on the window, never the page itself; what comes back is
 * how the page stands, its address, title, and whether it can step back or
 * forward, on the panel's own `onBrowserState`, and a still of it while
 * something covers it. Nothing here enters app state, a trace, or a count.
 */

import { Schema } from "effect";

/** The longest address the tab opens, as a browser's own address bar takes it. */
const BROWSER_ADDRESS_MAX_CHARS = 2_048;

/** The longest address or title the tab is told a page stands at; a longer one is cut, since it is only drawn. */
export const BROWSER_SHOWN_MAX_CHARS = 8_192;

/** The schemes a Browser tab loads: the web's, and nothing that hands an address to another app. */
const BROWSER_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/** An address that names its own scheme, `name://`, which a typed line is taken at its word on. */
const NAMED_SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;

/**
 * A typed line that is a host, with a port or a path or neither: dotted
 * labels, `localhost`, or a bracketed IPv6, and no space. Note that a label
 * holds no dot, so the pattern reads a line one way only and never backtracks
 * over it.
 */
const HOST_LIKE =
  /^(?:localhost|\[[\da-f:]+\]|[^\s/:?#.]+(?:\.[^\s/:?#.]+)+)(?::\d{1,5})?(?:[/?#]\S*)?$/iu;

/** Hosts served on the Mac or its own network, which are opened over plain http, as a dev server serves them. */
const LOCAL_HOST =
  /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2})$/iu;

/** Where words that are not an address are looked up, as a browser's address bar does. */
const SEARCH = "https://www.google.com/search?q=";

/** The steps a Browser tab's bar takes its page through. */
export const BROWSER_STEP = {
  BACK: "back",
  FORWARD: "forward",
  RELOAD: "reload",
  STOP: "stop",
} as const;

export type BrowserStep = (typeof BROWSER_STEP)[keyof typeof BROWSER_STEP];

/** Whether an address is one a Browser tab loads: an absolute http or https address the URL parser reads, no longer than the bar takes. */
export function isBrowserAddress(address: string): boolean {
  if (address.length > BROWSER_ADDRESS_MAX_CHARS || !URL.canParse(address)) return false;
  return BROWSER_SCHEMES.has(new URL(address).protocol);
}

/** The address a host-like line opens: over http for a host on the Mac or its network, over https for any other. */
function hostAddress(line: string): string | undefined {
  const host = line.split(/[/?#]/u, 1)[0]?.replace(/:\d+$/u, "") ?? "";
  const address = `${LOCAL_HOST.test(host) ? "http" : "https"}://${line}`;
  return isBrowserAddress(address) ? new URL(address).href : undefined;
}

/**
 * The address a line typed into a Browser tab's bar opens, as a browser's
 * address bar reads one: an http or https address as written; a host, with
 * a port and a path or not, over http where it is the Mac's own or its
 * network's, `localhost:3000` among them, and https elsewhere; and any other
 * words as a search. Nothing for an empty line, and nothing for an address
 * of another scheme, `file://` or another app's, which the tab loads none of.
 */
export function browserAddressOf(typed: string): string | undefined {
  const line = typed.trim();
  // Note that a line too long to open is refused before any pattern reads it.
  if (line.length === 0 || line.length > BROWSER_ADDRESS_MAX_CHARS) return undefined;
  if (NAMED_SCHEME.test(line)) return isBrowserAddress(line) ? new URL(line).href : undefined;
  if (HOST_LIKE.test(line)) return hostAddress(line);
  const search = `${SEARCH}${encodeURIComponent(line)}`;
  return isBrowserAddress(search) ? search : undefined;
}

const browserId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

const browserAddress = Schema.String.check(Schema.makeFilter(isBrowserAddress));

const shown = Schema.String.check(Schema.isMaxLength(BROWSER_SHOWN_MAX_CHARS));

/** A length on the window in CSS pixels, whole. */
const pixels = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }));

/** A call that names one Browser tab's view. */
export const browserViewParamsSchema = Schema.Struct({ browserId });

/** An open, or a navigation: the view, and the address it loads. */
export const browserAddressParamsSchema = Schema.Struct({ browserId, address: browserAddress });

/** A step of the bar's: back, forward, reload, or stop. */
export const browserStepParamsSchema = Schema.Struct({
  browserId,
  step: Schema.Literals(Object.values(BROWSER_STEP)),
});

/** Where the tab's body stands in the panel's window, in its CSS pixels. */
const browserBoundsSchema = Schema.Struct({
  x: pixels,
  y: pixels,
  width: pixels,
  height: pixels,
});

export type BrowserBounds = typeof browserBoundsSchema.Type;

/** Where the view stands over the window, or none while it is to be out of sight. */
export const browserPlaceParamsSchema = Schema.Struct({
  browserId,
  bounds: Schema.NullOr(browserBoundsSchema),
});

/** How one Browser tab's page stands: where it is, what it calls itself, and which of the bar's steps it can take. */
export const browserPageSchema = Schema.Struct({
  browserId,
  address: shown,
  title: shown,
  loading: Schema.Boolean,
  back: Schema.Boolean,
  forward: Schema.Boolean,
  /** Why the page last failed to load, in the browser's words; none once one loads. */
  failure: Schema.optional(shown),
});

export type BrowserPage = typeof browserPageSchema.Type;

/** Whether a value is how a Browser tab's page stands, as the panel is told on `onBrowserState`. */
export const isBrowserPage = Schema.is(browserPageSchema);

const keyName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32));

/**
 * A Command chord pressed while a Browser tab's page held the keyboard,
 * which main hands back to the panel so the window's own chords answer over
 * the page as they do over any tab: the key as the page heard it, and the
 * modifiers beside Command. The page keeps the chords it edits text with.
 */
const browserKeySchema = Schema.Struct({
  browserId,
  key: keyName,
  code: keyName,
  shift: Schema.Boolean,
  alt: Schema.Boolean,
  control: Schema.Boolean,
});

export type BrowserKey = typeof browserKeySchema.Type;

/** Whether a value is a chord handed back from a Browser tab's page, as the panel is told on `onBrowserKey`. */
export const isBrowserKey = Schema.is(browserKeySchema);

/** The keys a page keeps under Command, since they edit its text: copy, paste, cut, select all, and undo or redo. */
const PAGE_KEPT_KEYS: ReadonlySet<string> = new Set(["c", "v", "x", "a", "z"]);

/** Whether a Command chord pressed over a page is the window's to answer, rather than one the page edits text with. */
export function chordIsWindows(chord: Omit<BrowserKey, "browserId" | "code">): boolean {
  return chord.alt || chord.control || !PAGE_KEPT_KEYS.has(chord.key.toLowerCase());
}
