import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { listMcpTools, MCP_TOOLS_FAILURE } from "../server/hosted/mcp-tools.js";

/**
 * Why a provider's MCP server listed no tools, as the tools read keeps it:
 * the server's own JSON-RPC message where it sent one under an error
 * status, and never a message that could carry the account's bearer.
 */

const URL = "https://mcp.example.test/mcp";
const TOKEN = "xoxp-account-bearer";

/** A server that answers every request with `status` and a JSON-RPC error of `code` and `message`. */
function refusingServer(status: number, code: number, message: string) {
  return fakeHttpClientLayer(
    () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

it.effect("a 400 with a JSON-RPC error keeps the server's code and message", () =>
  Effect.gen(function* () {
    const failure = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(refusingServer(400, -32600, "App is not enabled for Slack MCP server access")),
      Effect.flip,
    );

    assert.equal(failure.reason, MCP_TOOLS_FAILURE.REJECTED);
    assert.equal(failure.code, -32600);
    assert.equal(failure.serverMessage, "App is not enabled for Slack MCP server access");
  }),
);

it.effect("a server message that carries the bearer is dropped whole", () =>
  Effect.gen(function* () {
    const failure = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(refusingServer(400, -32600, `no access for ${TOKEN}`)),
      Effect.flip,
    );

    assert.equal(failure.reason, MCP_TOOLS_FAILURE.REJECTED);
    assert.equal(failure.serverMessage, undefined);
  }),
);

it.effect("an error status with no JSON-RPC error is unreachable", () =>
  Effect.gen(function* () {
    const failure = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(fakeHttpClientLayer(() => new Response("Bad Request", { status: 400 }))),
      Effect.flip,
    );

    assert.equal(failure.reason, MCP_TOOLS_FAILURE.UNREACHABLE);
    assert.equal(failure.serverMessage, undefined);
  }),
);
