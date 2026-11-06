import { TEXT_LINK_MARK_CLASS } from "./components/text-link/text-link.js";
import { TEXT_LINK_LOOK } from "./components/text-link/text-link-look.js";

export const TEXT_LINK_MARK_ATTRIBUTES = {
  class: TEXT_LINK_MARK_CLASS,
  "data-look": TEXT_LINK_LOOK.UNDERLINED,
} as const;

const INERT_LINK_MARK_ATTRIBUTES = {
  class: "text-inherit no-underline cursor-text",
} as const;

export interface LinkFace {
  readonly words: string;
  readonly shortened: boolean;
}

const SHORT_URL = {
  MAX_CHARS: 44,
  MAX_LEAF_CHARS: 24,
  MAX_QUERY_CHARS: 24,
} as const;

const FOLD = "…";

const WEB_SCHEME = /^https?:\/\//iu;

export function linkMarkAttributes(
  href: string,
): typeof TEXT_LINK_MARK_ATTRIBUTES | typeof INERT_LINK_MARK_ATTRIBUTES {
  return WEB_SCHEME.test(href) ? TEXT_LINK_MARK_ATTRIBUTES : INERT_LINK_MARK_ATTRIBUTES;
}

function bareAddress(address: string): string {
  return address.trim().replace(WEB_SCHEME, "").replace(/\/$/u, "");
}

function stepWords(step: string): string {
  try {
    return decodeURIComponent(step);
  } catch {
    return step;
  }
}

function cut(words: string, room: number): string {
  return words.length <= room ? words : `${words.slice(0, room - 1)}${FOLD}`;
}

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

function saysOwnAddress(href: string, words: string): boolean {
  return bareAddress(words) === bareAddress(href);
}

export function siteName(href: string): string | undefined {
  if (!WEB_SCHEME.test(href) || !URL.canParse(href)) return undefined;
  return new URL(href).hostname.replace(/^www\./u, "");
}

export function linkFace(href: string, words: string): LinkFace {
  const short = saysOwnAddress(href, words) ? shortUrl(href) : undefined;
  return short === undefined ? { words, shortened: false } : { words: short, shortened: true };
}
