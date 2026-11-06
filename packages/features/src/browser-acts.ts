const BROWSER_ADDRESS_MAX_CHARS = 2_048;

export const BROWSER_SHOWN_MAX_CHARS = 8_192;

const BROWSER_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

const NAMED_SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;

const HOST_LIKE =
  /^(?:localhost|\[[\da-f:]+\]|[^\s/:?#.]+(?:\.[^\s/:?#.]+)+\.?)(?::\d{1,5})?(?:[/?#]\S*)?$/iu;

const LOCAL_HOST =
  /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2})$/iu;

const SEARCH = "https://www.google.com/search?q=";

export function isBrowserAddress(address: string): boolean {
  if (address.length > BROWSER_ADDRESS_MAX_CHARS || !URL.canParse(address)) return false;
  return BROWSER_SCHEMES.has(new URL(address).protocol);
}

function hostAddress(line: string): string | undefined {
  const host = line.split(/[/?#]/u, 1)[0]?.replace(/:\d+$/u, "") ?? "";
  const address = `${LOCAL_HOST.test(host) ? "http" : "https"}://${line}`;
  return isBrowserAddress(address) ? new URL(address).href : undefined;
}

export function browserAddressOf(typed: string): string | undefined {
  const line = typed.trim();
  if (line.length === 0 || line.length > BROWSER_ADDRESS_MAX_CHARS) return undefined;
  if (NAMED_SCHEME.test(line)) return isBrowserAddress(line) ? new URL(line).href : undefined;
  if (HOST_LIKE.test(line)) return hostAddress(line);
  const search = `${SEARCH}${encodeURIComponent(line)}`;
  return isBrowserAddress(search) ? search : undefined;
}

interface BrowserChord {
  readonly key: string;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly control: boolean;
}

const PAGE_KEPT_KEYS: ReadonlySet<string> = new Set(["c", "v", "x", "a", "z"]);

export function chordIsWindows(chord: BrowserChord): boolean {
  if (!chord.meta) return chord.control && !chord.alt && chord.key === "Tab";
  return chord.alt || chord.control || !PAGE_KEPT_KEYS.has(chord.key.toLowerCase());
}
