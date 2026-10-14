import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { listMcpTools, MCP_TOOLS_FAILURE } from "../server/hosted/mcp-tools.js";

/**
 * What the tools read keeps of a provider's MCP server: each tool's hints
 * exactly as the server sent them, and none it did not send; and why a
 * server listed no tools, with the server's own JSON-RPC message where it
 * sent one under an error status, and never a message that could carry the
 * account's bearer.
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

/** A server whose `tools/list` answers `tools`, as one JSON body per request. */
function listingServer(tools: readonly unknown[]) {
  return fakeHttpClientLayer(async (_url, init) => {
    // The session's end, and a notification, answer nothing.
    if ((init.method ?? "GET") !== "POST") return new Response(null, { status: 200 });
    // SAFETY: the client sends one JSON-RPC message per request.
    const message = JSON.parse(await new Response(init.body).text()) as {
      id?: number;
      method: string;
    };
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result =
      message.method === "tools/list"
        ? { tools }
        : { protocolVersion: "2025-06-18", capabilities: {} };
    return Response.json({ jsonrpc: "2.0", id: message.id, result });
  });
}

it.effect("a tool keeps the hints its server sent, and only those", () =>
  Effect.gen(function* () {
    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(
        listingServer([
          {
            name: "delete_project",
            description: "Deletes a project.",
            annotations: { title: "Delete project", readOnlyHint: false, destructiveHint: true },
          },
          {
            name: "list_projects",
            description: "Lists projects.",
            annotations: { readOnlyHint: true },
          },
          { name: "get_project", description: "Gets a project." },
          { name: "deploy", description: "Deploys.", annotations: {} },
        ]),
      ),
    );

    assert.deepEqual(tools, [
      {
        name: "delete_project",
        description: "Deletes a project.",
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      {
        name: "list_projects",
        description: "Lists projects.",
        annotations: { readOnlyHint: true },
      },
      { name: "get_project", description: "Gets a project." },
      { name: "deploy", description: "Deploys." },
    ]);
  }),
);

it.effect("a tool whose hints are malformed is kept without them", () =>
  Effect.gen(function* () {
    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(
        listingServer([
          { name: "purge", description: "Purges.", annotations: { destructiveHint: "yes" } },
          { name: "read", description: "Reads.", annotations: "read-only" },
        ]),
      ),
    );

    assert.deepEqual(tools, [
      { name: "purge", description: "Purges." },
      { name: "read", description: "Reads." },
    ]);
  }),
);

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

it.effect("a server message that echoes part of the bearer is dropped whole", () =>
  Effect.gen(function* () {
    const failure = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(refusingServer(400, -32600, `token ${TOKEN.slice(0, 14)}… is not allowed`)),
      Effect.flip,
    );

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
