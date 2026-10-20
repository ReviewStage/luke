/**
 * sentry-breadcrumbs.ts -- the breadcrumbs, events, and spans a renderer's or a tab's reports may carry: none that carries a LiveKit access token.
 *
 * A renderer's `fetch`, XHR, and console become Sentry breadcrumbs, and the
 * panel's avatar session joins a LiveKit room whose failed join asks
 * `https://<host>/rtc/v1/validate?access_token=…`, the grant's own token in
 * the query. That token may reach the panel and never a crash report,
 * so a breadcrumb that names one anywhere it carries text is dropped whole
 * rather than redacted: a URL or a console line is free text, and a pattern
 * that missed one spelling would send the rest. An event is held to the same
 * rule, since a failed join's error can carry the same URL in its message.
 * Every renderer's page, its preload, and main all report, so all three drop
 * them, and so does the web app's tab (`apps/web/src/app/web-sentry-sdk.ts`),
 * on the same terms.
 *
 * A span is held to it too, since browser tracing records each request as a
 * span whose attributes carry its URL; but Sentry streams spans one at a
 * time (`traceLifecycle: "stream"`, the only lifecycle its next major keeps),
 * and a streamed span can be dropped only as it starts (`ignoreSpans`), never
 * once it has ended (`beforeSendSpan` may change it, not drop it). So a span
 * whose name or address names the token as it starts is never recorded, and
 * every span that is sent has each address it carries scrubbed
 * (`sentry-addresses.ts`: query values, fragment, user info, and
 * credential-shaped path segments), and any other text naming the token
 * replaced.
 *
 * Written against the few fields read rather than one SDK's types, so the
 * desktop's `@sentry/electron` and the web's `@sentry/browser` each hand
 * their own breadcrumbs, events, and spans here and get back exactly what
 * they gave.
 */

import { Predicate } from "effect";
import {
  isAddressAttribute,
  REDACTED,
  scrubbedAttributes,
  scrubbedUrl,
} from "./sentry-addresses.js";

/** What of a breadcrumb is read: its message and its request's URL. */
interface BreadcrumbText {
  readonly message?: string;
  readonly data?: { readonly url?: unknown };
}

/** What of an error event is read: its message, its request's URL, and each exception's message. */
interface EventText {
  readonly message?: string;
  readonly request?: { readonly url?: string };
  readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
}

/** What of a streamed span is read and scrubbed: its name and its attributes. */
interface SpanText {
  readonly name: string;
  readonly attributes: object;
}

/** A pattern Sentry's `ignoreSpans` drops a span by as it starts: its name, or one of its attributes. */
type IgnoredSpan = string | { readonly attributes: Readonly<Record<string, string>> };

/** The query parameter LiveKit carries the participant token in. */
const ACCESS_TOKEN_PARAMETER = "access_token";

/**
 * The attributes a request's span carries its address in as it starts:
 * browser tracing's and Electron's `url.full`, and Node's `http.url`, under
 * the names `@sentry/conventions` gives them, and the bare `url`
 * an integration may set.
 */
const STARTING_ADDRESS_ATTRIBUTES = ["url.full", "http.url", "url"] as const;

function namesAccessToken(texts: readonly unknown[]): boolean {
  return texts.some((text) => Predicate.isString(text) && text.includes(ACCESS_TOKEN_PARAMETER));
}

/** An attribute as it may be sent: an address scrubbed already, and any other text naming the token replaced. */
function attributeWithoutAccessToken([name, value]: [string, unknown]): [string, unknown] {
  if (isAddressAttribute(name)) return [name, value];
  // Note that an array is read string by string, as the browser's HTTP context sets a header as one.
  if (Array.isArray(value))
    return [name, value.map((item) => (namesAccessToken([item]) ? REDACTED : item))];
  return [name, namesAccessToken([value]) ? REDACTED : value];
}

/** What separates a URL's scheme from its authority. */
const SCHEME_SEPARATOR = "://";

/** A character a URL's scheme may hold, and one it may start with. */
const SCHEME_CHARACTER = /^[a-z0-9+.-]$/i;
const SCHEME_START = /^[a-z]$/i;

/**
 * Where an absolute URL starts inside a word of a span's name, as in
 * `url=https://…`, or -1. Note that the scheme is read back from its `://`
 * one character at a time rather than searched for with a pattern, because a
 * pattern searched across a long word is retried from every offset.
 */
function urlStart(word: string): number {
  const separatorAt = word.indexOf(SCHEME_SEPARATOR);
  if (separatorAt === -1) return -1;
  let at = separatorAt;
  while (at > 0 && SCHEME_CHARACTER.test(word.charAt(at - 1))) at--;
  while (at < separatorAt && !SCHEME_START.test(word.charAt(at))) at++;
  return at === separatorAt ? -1 : at;
}

/**
 * A word of a span's name as it may be sent: from where an absolute URL
 * starts in it, or the whole of a path from the root, scrubbed as an
 * attribute's address is. Note that other words are kept, because a name
 * also holds words such as an element's selector (`button#send`), whose `#`
 * is no fragment.
 */
function scrubbedWord(word: string): string {
  const urlAt = urlStart(word);
  if (urlAt !== -1) return `${word.slice(0, urlAt)}${scrubbedUrl(word.slice(urlAt))}`;
  return word.startsWith("/") ? scrubbedUrl(word) : word;
}

/**
 * A span's name as it may be sent: replaced whole where it names the token,
 * and otherwise each address in it scrubbed as an attribute's is. Note that
 * Sentry's own spans are named by method and host alone when streamed; this
 * holds a name Luke gives a span to the same rule.
 */
function nameWithoutAccessToken(name: string): string {
  if (namesAccessToken([name])) return REDACTED;
  return name.split(" ").map(scrubbedWord).join(" ");
}

/** Whether a breadcrumb's text names the token, in its message or its request's URL. */
function carriesAccessToken(breadcrumb: BreadcrumbText): boolean {
  return namesAccessToken([breadcrumb.message, breadcrumb.data?.url]);
}

/** Sentry's `beforeBreadcrumb`: the breadcrumb as it was, or nothing where it carries a token. */
export function withoutAccessTokens<Crumb extends BreadcrumbText>(breadcrumb: Crumb): Crumb | null {
  return carriesAccessToken(breadcrumb) ? null : breadcrumb;
}

/**
 * Sentry's `beforeSend`: the event as it was, or nothing where its message,
 * an exception's message, or its request's URL names the token.
 */
export function eventWithoutAccessTokens<Event extends EventText>(event: Event): Event | null {
  const exceptions = event.exception?.values ?? [];
  const texts = [event.message, event.request?.url, ...exceptions.map((caught) => caught.value)];
  return namesAccessToken(texts) ? null : event;
}

/**
 * Sentry's `ignoreSpans`: a span whose name, or whose address as it starts,
 * names the token is never recorded, and so never sent. Note that Sentry
 * matches a string here as a substring of the value.
 */
export const SPANS_NAMING_ACCESS_TOKENS: IgnoredSpan[] = [
  ACCESS_TOKEN_PARAMETER,
  ...STARTING_ADDRESS_ATTRIBUTES.map((name) => ({
    attributes: { [name]: ACCESS_TOKEN_PARAMETER },
  })),
];

/**
 * Sentry's streamed `beforeSendSpan`, which every span that was recorded
 * passes as it is sent: each address it carries, in its name or its
 * attributes, scrubbed, and its name or any other attribute that names the
 * token replaced. Wrap it in the SDK's
 * `withStreamedSpan`.
 */
export function spanWithoutAccessTokens<Span extends SpanText>(span: Span): Span {
  const scrubbed = Object.entries(scrubbedAttributes(span.attributes));
  // SAFETY: each attribute keeps its name, and a value is replaced only by a string, as Sentry's own attributes allow.
  return {
    ...span,
    name: nameWithoutAccessToken(span.name),
    attributes: Object.fromEntries(scrubbed.map(attributeWithoutAccessToken)),
  } as Span;
}
