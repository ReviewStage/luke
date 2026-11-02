/**
 * platform-landing.ts -- a client's request as Vercel lands it on a function, by the committed rewrite table: for the local server, which answers as the deployment does, and for the tests that hold a client's URL to the route it means.
 *
 * Vercel serves a path by the first rewrite of the table
 * (`api-rewrites.json`) whose pattern matches the whole path, writes the
 * pattern's groups into the destination, and merges the caller's own query
 * after the destination's; the grouped function's dispatcher then restores
 * the path the route was written against (`function-dispatch.ts`). A test
 * that went straight to the route would walk past both, which is how a File
 * tab whose every read answered 404 on production stayed green.
 */

import type { Rewrite } from "./function-rewrites.js";

/** Node's fetch takes a streamed body only with `duplex` said in as many words, which the DOM's `RequestInit` has no field for. */
type StreamingRequestInit = RequestInit & { readonly duplex?: "half" };

function wholePath(rewrite: Rewrite): RegExp {
  return new RegExp(`^${rewrite.src}$`);
}

/** The rule a path lands by: the table's first whose pattern matches the whole path, or undefined where none does, which on Vercel is a page's path. */
export function landingRule(pathname: string, rewrites: readonly Rewrite[]): Rewrite | undefined {
  return rewrites.find((rewrite) => wholePath(rewrite).test(pathname));
}

/** The client's request as it arrives at its function by the rule its path landed on: rewritten, its own query, headers, body, and signal kept. */
export function landed(request: Request, rule: Rewrite): Request {
  const asked = new URL(request.url);
  const url = new URL(asked.pathname.replace(wholePath(rule), rule.dest), asked.origin);
  for (const [name, value] of asked.searchParams) url.searchParams.append(name, value);
  const init: StreamingRequestInit = {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  };
  if (request.body === null) return new Request(url, init);
  const streaming: StreamingRequestInit = { ...init, body: request.body, duplex: "half" };
  return new Request(url, streaming);
}
