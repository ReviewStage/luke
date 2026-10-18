/**
 * link-face.ts -- what a plain link's words say: its label, or, where its words are its own address, the address cut to its host and path.
 *
 * A link the window draws as words rather than a chip (the desktop's
 * `text-link.tsx`) says its label. Where its words are its address, as a
 * bare `https://…` written into a reply or a plan autolinks to itself, it
 * says the address as a reader names a page instead: the host without its
 * `www.`, then the path, a short query kept and the fragment dropped, and
 * past a bound the middle steps folded to `…` and a long last step cut. The
 * whole address stays the link's own, shown on hover. Nothing here draws:
 * both of the desktop's Markdown renderers read the same face.
 */

import { TEXT_LINK_LOOK } from "./components/text-link/text-link-look.js";

/**
 * What a link an engine draws without React wears, the plan editor's link
 * mark, so it looks as an underlined TextLink does.
 */
export const TEXT_LINK_MARK_ATTRIBUTES = {
  class: "luke-text-link",
  "data-look": TEXT_LINK_LOOK.UNDERLINED,
} as const;

/** A link's face: the words it says, and whether they are its address cut short. */
export interface LinkFace {
  readonly words: string;
  readonly shortened: boolean;
}

const SHORT_URL = {
  /** The most characters a short address says before its middle steps fold. */
  MAX_CHARS: 44,
  /** The most characters of a folded address's last step. */
  MAX_LEAF_CHARS: 24,
  /** The longest query a short address keeps, `?` and all. */
  MAX_QUERY_CHARS: 24,
} as const;

const FOLD = "…";

/** The schemes a link's words may spell its address with. */
const WEB_SCHEME = /^https?:\/\//iu;

/** An address as a reader compares it with words: no scheme, no trailing slash. */
function bareAddress(address: string): string {
  return address.trim().replace(WEB_SCHEME, "").replace(/\/$/u, "");
}

/** A path step as words, decoded where it decodes. */
function stepWords(step: string): string {
  try {
    return decodeURIComponent(step);
  } catch {
    return step;
  }
}

/** Words cut to a bound, the cut marked. */
function cut(words: string, room: number): string {
  return words.length <= room ? words : `${words.slice(0, room - 1)}${FOLD}`;
}

/** A web address as a reader names its page: host and path, folded past the bound; nothing for an address that is not the web's. */
export function shortUrl(href: string): string | undefined {
  if (!WEB_SCHEME.test(href) || !URL.canParse(href)) return undefined;
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./u, "");
  const steps = url.pathname
    .split("/")
    .filter((step) => step !== "")
    .map(stepWords);
  const query = url.search.length <= SHORT_URL.MAX_QUERY_CHARS ? url.search : "";
  const whole = `${[host, ...steps].join("/")}${query}`;
  if (whole.length <= SHORT_URL.MAX_CHARS) return whole;
  const leaf = cut(steps.at(-1) ?? "", SHORT_URL.MAX_LEAF_CHARS);
  const headed = `${host}/${steps[0]}/${FOLD}/${leaf}`;
  if (steps.length > 2 && headed.length <= SHORT_URL.MAX_CHARS) return headed;
  return steps.length > 1 ? `${host}/${FOLD}/${leaf}` : `${host}/${leaf}`;
}

/** What a link to `href` labelled `words` says: its address cut short where the words are the address, its label otherwise. */
export function linkFace(href: string, words: string): LinkFace {
  const short = bareAddress(words) === bareAddress(href) ? shortUrl(href) : undefined;
  return short === undefined ? { words, shortened: false } : { words: short, shortened: true };
}
