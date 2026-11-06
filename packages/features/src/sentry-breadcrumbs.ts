import { Predicate } from "effect";
import {
  isAddressAttribute,
  REDACTED,
  scrubbedAttributes,
  scrubbedUrl,
} from "./sentry-addresses.js";

interface BreadcrumbText {
  readonly message?: string;
  readonly data?: { readonly url?: unknown };
}

interface EventText {
  readonly message?: string;
  readonly request?: { readonly url?: string };
  readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
}

interface SpanText {
  readonly name: string;
  readonly attributes: object;
}

type IgnoredSpan = string | { readonly attributes: Readonly<Record<string, string>> };

const ACCESS_TOKEN_PARAMETER = "access_token";

const STARTING_ADDRESS_ATTRIBUTES = ["url.full", "http.url", "url"] as const;

function namesAccessToken(texts: readonly unknown[]): boolean {
  return texts.some((text) => Predicate.isString(text) && text.includes(ACCESS_TOKEN_PARAMETER));
}

function attributeWithoutAccessToken([name, value]: [string, unknown]): [string, unknown] {
  if (isAddressAttribute(name)) return [name, value];
  if (Array.isArray(value))
    return [name, value.map((item) => (namesAccessToken([item]) ? REDACTED : item))];
  return [name, namesAccessToken([value]) ? REDACTED : value];
}

const SCHEME_SEPARATOR = "://";

const SCHEME_CHARACTER = /^[a-z0-9+.-]$/i;
const SCHEME_START = /^[a-z]$/i;

function schemeStart(word: string, separatorAt: number): number {
  let at = separatorAt;
  while (at > 0 && SCHEME_CHARACTER.test(word.charAt(at - 1))) at--;
  while (at < separatorAt && !SCHEME_START.test(word.charAt(at))) at++;
  return at === separatorAt ? -1 : at;
}

function urlStarts(word: string): number[] {
  const starts: number[] = [];
  let separatorAt = word.indexOf(SCHEME_SEPARATOR);
  while (separatorAt !== -1) {
    const start = schemeStart(word, separatorAt);
    if (start !== -1) starts.push(start);
    separatorAt = word.indexOf(SCHEME_SEPARATOR, separatorAt + SCHEME_SEPARATOR.length);
  }
  return starts;
}

function scrubbedWord(word: string): string {
  const starts = urlStarts(word);
  if (starts.length === 0) return word.startsWith("/") ? scrubbedUrl(word) : word;
  const urls = starts.map((start, index) => scrubbedUrl(word.slice(start, starts[index + 1])));
  return `${word.slice(0, starts[0])}${urls.join("")}`;
}

function nameWithoutAccessToken(name: string): string {
  if (namesAccessToken([name])) return REDACTED;
  return name.split(" ").map(scrubbedWord).join(" ");
}

function carriesAccessToken(breadcrumb: BreadcrumbText): boolean {
  return namesAccessToken([breadcrumb.message, breadcrumb.data?.url]);
}

export function withoutAccessTokens<Crumb extends BreadcrumbText>(breadcrumb: Crumb): Crumb | null {
  return carriesAccessToken(breadcrumb) ? null : breadcrumb;
}

export function eventWithoutAccessTokens<Event extends EventText>(event: Event): Event | null {
  const exceptions = event.exception?.values ?? [];
  const texts = [event.message, event.request?.url, ...exceptions.map((caught) => caught.value)];
  return namesAccessToken(texts) ? null : event;
}

export const SPANS_NAMING_ACCESS_TOKENS: IgnoredSpan[] = [
  ACCESS_TOKEN_PARAMETER,
  ...STARTING_ADDRESS_ATTRIBUTES.map((name) => ({
    attributes: { [name]: ACCESS_TOKEN_PARAMETER },
  })),
];

export function spanWithoutAccessTokens<Span extends SpanText>(span: Span): Span {
  const scrubbed = Object.entries(scrubbedAttributes(span.attributes));
  return {
    ...span,
    name: nameWithoutAccessToken(span.name),
    attributes: Object.fromEntries(scrubbed.map(attributeWithoutAccessToken)),
  } as Span;
}
