import { Predicate } from "effect";
import { redactCredentials } from "./credential-redaction.js";

export const REDACTED = "[redacted]";

const UUID_SEGMENT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const URL_AUTHORITY_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

export type QueryParams = string | [string, string][] | Record<string, string>;

function scrubbedSegment(segment: string): string {
  if (UUID_SEGMENT_PATTERN.test(segment)) return segment;
  return redactCredentials(segment) === segment ? segment : REDACTED;
}

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

export function isAddressAttribute(name: string): boolean {
  return URL_ATTRIBUTES.has(name);
}

export function scrubbedAttributes<Attributes extends object>(attributes: Attributes): Attributes {
  const entries = Object.entries(attributes).map(([name, value]: [string, unknown]) => {
    const scrub = URL_ATTRIBUTES.get(name);
    if (scrub === undefined) return [name, value];
    if (Array.isArray(value))
      return [name, value.map((item) => (Predicate.isString(item) ? scrub(item) : item))];
    return [name, Predicate.isString(value) ? scrub(value) : value];
  });
  return Object.fromEntries(entries) as Attributes;
}

export function scrubbedQueryParams(query: QueryParams): QueryParams {
  if (Predicate.isString(query)) return scrubbedQuery(query);
  if (Array.isArray(query))
    return query.map(([name]): [string, string] => [scrubbedSegment(name), REDACTED]);
  return Object.fromEntries(Object.keys(query).map((name) => [scrubbedSegment(name), REDACTED]));
}
