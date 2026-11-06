import type { Rewrite } from "./function-rewrites.js";

type StreamingRequestInit = RequestInit & { readonly duplex?: "half" };

function wholePath(rewrite: Rewrite): RegExp {
  return new RegExp(`^${rewrite.src}$`);
}

export function landingRule(pathname: string, rewrites: readonly Rewrite[]): Rewrite | undefined {
  return rewrites.find((rewrite) => wholePath(rewrite).test(pathname));
}

export function landedPath(pathname: string, rule: Rewrite): string {
  return pathname.replace(wholePath(rule), rule.dest);
}

export function landed(request: Request, rule: Rewrite): Request {
  const asked = new URL(request.url);
  const url = new URL(landedPath(asked.pathname, rule), asked.origin);
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
