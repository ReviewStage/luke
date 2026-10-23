/**
 * browser-acts.ts -- how a Browser tab's bar reads what is typed into it, which addresses a Browser tab loads, and which chords pressed over its page stay the window's.
 *
 * A Browser tab draws a page of an agent's cloud browser beside the plan
 * (`cloud-browser-pane.tsx`): its bar opens a typed line as a browser's
 * address bar would, the service and the live-view relay load no address
 * but an http or https one, and a Command chord pressed while the member
 * drives the page is the window's unless the page edits text with it.
 * Nothing here enters app state, a trace, or a count.
 */

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
 * labels, a fully qualified name's trailing dot among them, `localhost`, or a
 * bracketed IPv6, and no space. Note that a label holds no dot, so the
 * pattern reads a line one way only and never backtracks over it.
 */
const HOST_LIKE =
  /^(?:localhost|\[[\da-f:]+\]|[^\s/:?#.]+(?:\.[^\s/:?#.]+)+\.?)(?::\d{1,5})?(?:[/?#]\S*)?$/iu;

/** Hosts served on the machine itself or its own network, which are opened over plain http, as a dev server serves them. */
const LOCAL_HOST =
  /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2})$/iu;

/** Where words that are not an address are looked up, as a browser's address bar does. */
const SEARCH = "https://www.google.com/search?q=";

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

/** A chord pressed over a page: the key as the page heard it, and its modifiers. */
interface BrowserChord {
  readonly key: string;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly control: boolean;
}

/** The keys a page keeps under Command, since they edit its text: copy, paste, cut, select all, and undo or redo. */
const PAGE_KEPT_KEYS: ReadonlySet<string> = new Set(["c", "v", "x", "a", "z"]);

/**
 * Whether a chord pressed over a page is the window's to answer: a Command
 * chord but those the page edits text with, and ⌃Tab or ⌃⇧Tab, the tab
 * switcher's, which a page would otherwise take as its own focus move.
 */
export function chordIsWindows(chord: BrowserChord): boolean {
  if (!chord.meta) return chord.control && !chord.alt && chord.key === "Tab";
  return chord.alt || chord.control || !PAGE_KEPT_KEYS.has(chord.key.toLowerCase());
}
