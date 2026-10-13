/**
 * mcp-server-fake.ts -- a provider's hosted MCP server as a suite scripts it, answering over the fake HttpClient.
 *
 * It speaks the part of streamable HTTP a tools read uses: `initialize`
 * opens a session and hands back its id, `notifications/initialized` is
 * accepted, `tools/list` answers its pages in order, and `DELETE` ends the
 * session. A request without the bearer it was told of is refused with 401.
 * Each page is answered as JSON or as an event stream, as the suite says,
 * and every request is recorded so a suite can hold how many sessions a read
 * opened.
 */

import type { FakeResponder } from "@sidecar/wire/testing";

interface ScriptedTool {
  readonly name: string;
  readonly description?: string;
}

export interface McpServerScript {
  /** The bearer the server accepts. */
  readonly token: string;
  /** The pages `tools/list` answers, in order; each but the last carries a cursor to the next. */
  readonly pages: readonly (readonly ScriptedTool[])[];
  /** Answers every request as an event stream rather than a JSON body. */
  readonly eventStream?: boolean;
}

export interface McpServerFake {
  readonly respond: FakeResponder;
  /** Every request's method, `DELETE` for a session ended, in order. */
  readonly methods: string[];
}

const SESSION = "session-1";

/** What the server answers a request with: the handshake's terms, or a page of tools. */
type ScriptedResult =
  | { readonly protocolVersion: string; readonly capabilities: { readonly tools: object } }
  | { readonly tools: readonly ScriptedTool[]; readonly nextCursor?: string };

function bodyOf(init: RequestInit): { method?: string; id?: number; params?: { cursor?: string } } {
  // The fake HttpClient hands a JSON body over as its bytes.
  const text = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : undefined;
  return text === undefined ? {} : JSON.parse(text);
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return new Headers(init.headers).get(name) ?? undefined;
}

export function mcpServerFake(script: McpServerScript): McpServerFake {
  const methods: string[] = [];
  const answer = (
    id: number | undefined,
    result: ScriptedResult,
    headers: Record<string, string> = {},
  ) => {
    const message = JSON.stringify({ jsonrpc: "2.0", id, result });
    return script.eventStream === true
      ? new Response(`event: message\ndata: ${message}\n\n`, {
          headers: { "content-type": "text/event-stream", ...headers },
        })
      : new Response(message, { headers: { "content-type": "application/json", ...headers } });
  };
  const respond: FakeResponder = (_url, init) => {
    if (headerOf(init, "authorization") !== `Bearer ${script.token}`) {
      methods.push("refused");
      return new Response("Bearer token rejected", { status: 401 });
    }
    if (init.method === "DELETE") {
      methods.push("DELETE");
      return new Response(null, { status: 200 });
    }
    const request = bodyOf(init);
    methods.push(request.method ?? "");
    switch (request.method) {
      case "initialize":
        return answer(
          request.id,
          { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
          { "mcp-session-id": SESSION },
        );
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list": {
        if (headerOf(init, "mcp-session-id") !== SESSION)
          return new Response(null, { status: 400 });
        const at = request.params?.cursor === undefined ? 0 : Number(request.params.cursor);
        const page = script.pages[at] ?? [];
        const next = at + 1 < script.pages.length ? { nextCursor: String(at + 1) } : {};
        return answer(request.id, { tools: page, ...next });
      }
      default:
        return new Response(null, { status: 400 });
    }
  };
  return { respond, methods };
}
