/**
 * sentry-addresses.ts -- the addresses a Sentry report carries, as it may keep them: query values, fragments, user info, and credential-shaped path segments redacted.
 *
 * Every process that reports to Sentry hands its spans, events, and log
 * lines through here: the service's functions and eve roots
 * (`@luke/service/observability/sentry`), and the clients' span filter
 * (`sentry-breadcrumbs.ts`) beneath the desktop's main process, its
 * renderers, and the web app's tab. Sentry's own URL filter redacts only a
 * query value whose name it knows (`token`, `auth`, `key`, ...), and keeps a
 * fragment and a path as they came, so `#access_token=…`, a token in a path,
 * and a value named `code`, `state`, or `sig` would otherwise be sent.
 *
 * Written against plain values rather than one SDK's types, so the service's
 * `@sentry/effect`, the desktop's `@sentry/electron`, and the web's
 * `@sentry/browser` each hand their own here and get back what they gave.
 */

import { Predicate } from "effect";
import { redactCredentials } from "./credential-redaction.js";

/** What a redacted value, segment, or fragment reads as. */
export const REDACTED = "[redacted]";

/** A UUID path segment, which names a row rather than proving who asks, so it is kept. */
const UUID_SEGMENT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An address's scheme and authority, user info included, ahead of its path. */
const URL_AUTHORITY_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/** A request's query as an event carries it: a string, its pairs, or its names and values. */
export type QueryParams = string | [string, string][] | Record<string, string>;

/** A path segment, kept unless it is shaped like a credential, which is replaced whole. */
function scrubbedSegment(segment: string): string {
  if (UUID_SEGMENT_PATTERN.test(segment)) return segment;
  return redactCredentials(segment) === segment ? segment : REDACTED;
}

/** A query string with every value redacted and its names kept, but for one shaped like a credential, so the shape of a request still reads. */
function scrubbedQuery(query: string): string {
  return query
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const name = scrubbedSegment(equals === -1 ? pair : pair.slice(0, equals));
      return equals === -1 ? name : `${name}=${REDACTED}`;
    })
    .join("&");
}

/**
 * An address, whole or a path alone: its user info, its query's values, its
 * fragment, and every credential-shaped path segment redacted; its scheme,
 * host, and the rest of its path kept as written.
 */
export function scrubbedUrl(address: string): string {
  const fragmentAt = address.indexOf("#");
  const beforeFragment = fragmentAt === -1 ? address : address.slice(0, fragmentAt);
  const queryAt = beforeFragment.indexOf("?");
  const beforeQuery = queryAt === -1 ? beforeFragment : beforeFragment.slice(0, queryAt);
  const authority = URL_AUTHORITY_PATTERN.exec(beforeQuery)?.[0] ?? "";
  const userAt = authority.lastIndexOf("@");
  const host =
    userAt === -1
      ? authority
      : `${authority.slice(0, authority.indexOf("//") + 2)}${REDACTED}${authority.slice(userAt)}`;
  const path = beforeQuery.slice(authority.length).split("/").map(scrubbedSegment).join("/");
  const query = queryAt === -1 ? "" : `?${scrubbedQuery(beforeFragment.slice(queryAt + 1))}`;
  const fragment = fragmentAt === -1 ? "" : `#${REDACTED}`;
  return `${host}${path}${query}${fragment}`;
}

/**
 * The attributes that carry an address, a path, or a query, by the names
 * Effect's HTTP spans and the browser's and Electron's request spans
 * (`url.*`), Sentry's HTTP integrations (`http.*`), a breadcrumb (`url`),
 * and the browser's HTTP context, which sets the page's referrer on every
 * segment span as a one-string array (`http.request.header.referer`), give
 * them, each with how it is scrubbed.
 */
const URL_ATTRIBUTES: ReadonlyMap<string, (value: string) => string> = new Map([
  ["url.full", scrubbedUrl],
  ["url.path", scrubbedUrl],
  ["url.query", scrubbedQuery],
  ["url.fragment", () => REDACTED],
  ["http.url", scrubbedUrl],
  ["http.target", scrubbedUrl],
  ["http.query", scrubbedQuery],
  ["http.fragment", () => REDACTED],
  ["url", scrubbedUrl],
  ["http.request.header.referer", scrubbedUrl],
]);

/** Whether an attribute of this name carries an address, and so is scrubbed by `scrubbedAttributes`. */
export function isAddressAttribute(name: string): boolean {
  return URL_ATTRIBUTES.has(name);
}

/** Attributes with every address among them, a string or an array of them, scrubbed and the rest as they were. */
export function scrubbedAttributes<Attributes extends object>(attributes: Attributes): Attributes {
  const entries = Object.entries(attributes).map(([name, value]: [string, unknown]) => {
    const scrub = URL_ATTRIBUTES.get(name);
    if (scrub === undefined) return [name, value];
    if (Array.isArray(value))
      return [name, value.map((item) => (Predicate.isString(item) ? scrub(item) : item))];
    return [name, Predicate.isString(value) ? scrub(value) : value];
  });
  // SAFETY: each entry keeps its name, and a string is replaced only by a string, in an array or not.
  return Object.fromEntries(entries) as Attributes;
}

/** A request's query as an event carries it, a string or its pairs, with every value redacted. */
export function scrubbedQueryParams(query: QueryParams): QueryParams {
  if (Predicate.isString(query)) return scrubbedQuery(query);
  if (Array.isArray(query))
    return query.map(([name]): [string, string] => [scrubbedSegment(name), REDACTED]);
  return Object.fromEntries(Object.keys(query).map((name) => [scrubbedSegment(name), REDACTED]));
}
