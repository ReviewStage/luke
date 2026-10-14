import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect } from "effect";
import { listMcpTools, MCP_TOOLS_FAILURE } from "../server/hosted/mcp-tools.js";

/**
 * What the tools read keeps of a provider's MCP server: each tool's title in
 * the spec's order, its description whole, bounded, its hints exactly as the
 * server sent them, and none it did not send, and the arguments its input
 * schema declares, each in a few words; and why a
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
        title: "Delete project",
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

it.effect("a tool keeps its description whole, every line of it, up to a bound", () =>
  Effect.gen(function* () {
    const long = "x".repeat(9000);
    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(
        listingServer([
          {
            name: "save_issue",
            description:
              "  Creates or updates an issue.\n\nPass an id to update one; omit it to create.  ",
          },
          { name: "huge", description: long },
        ]),
      ),
    );

    assert.equal(
      tools[0]?.description,
      "Creates or updates an issue.\n\nPass an id to update one; omit it to create.",
    );
    assert.equal(tools[1]?.description.length, 8000);
    assert.ok(tools[1]?.description.endsWith("…"));
  }),
);

it.effect("a tool's title is its own, else its annotations', and none where neither is words", () =>
  Effect.gen(function* () {
    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(
        listingServer([
          {
            name: "run_sql",
            title: "Run SQL",
            description: "Runs SQL.",
            annotations: { title: "Execute a statement" },
          },
          {
            name: "list_issues",
            description: "Lists issues.",
            annotations: { title: "List issues" },
          },
          {
            name: "blank",
            title: "  ",
            description: "Blank.",
            annotations: { title: "Blank tool" },
          },
          { name: "numbered", title: 7, description: "Numbered." },
          { name: "untitled", description: "Untitled." },
        ]),
      ),
    );

    assert.deepEqual(
      tools.map((tool) => [tool.name, tool.title]),
      [
        ["run_sql", "Run SQL"],
        ["list_issues", "List issues"],
        ["blank", "Blank tool"],
        ["numbered", undefined],
        ["untitled", undefined],
      ],
    );
  }),
);

it.effect("a tool keeps the arguments its input schema declares, each type in a few words", () =>
  Effect.gen(function* () {
    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(
        listingServer([
          {
            name: "search_issues",
            description: "Searches issues.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "  What to search for.  ",
                  default: "is:open",
                },
                labels: { type: "array", items: { type: "string" } },
                assignee: { type: ["string", "null"], description: "Null to remove." },
                sort: { type: "string", enum: ["date", "freq"], default: "date" },
                slaType: {
                  anyOf: [{ type: "string", enum: ["all", "business"] }, { type: "null" }],
                },
                limit: { type: "number", default: 10 },
                links: { type: "array", items: { type: "object", properties: {} } },
                ids: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
                anything: {},
              },
              required: ["query", "sort", "not_a_property"],
            },
          },
        ]),
      ),
    );

    assert.deepEqual(tools[0]?.parameters, [
      {
        name: "query",
        type: "string",
        required: true,
        description: "What to search for.",
        default: "is:open",
      },
      { name: "labels", type: "string[]", required: false },
      { name: "assignee", type: "string | null", required: false, description: "Null to remove." },
      { name: "sort", type: "enum", required: true, values: ["date", "freq"], default: "date" },
      { name: "slaType", type: "enum | null", required: false, values: ["all", "business"] },
      { name: "limit", type: "number", required: false, default: "10" },
      { name: "links", type: "object[]", required: false },
      { name: "ids", type: "(string | number)[]", required: false },
      { name: "anything", type: "any", required: false },
    ]);
  }),
);

it.effect(
  "a tool whose schema declares no arguments takes none, and one whose schema is unreadable says nothing of them",
  () =>
    Effect.gen(function* () {
      const tools = yield* listMcpTools(URL, TOKEN).pipe(
        Effect.provide(
          listingServer([
            { name: "whoami", description: "Who am I.", inputSchema: { type: "object" } },
            { name: "broken", description: "Broken.", inputSchema: "object" },
            { name: "odd", description: "Odd.", inputSchema: { type: "object", properties: [] } },
            { name: "bare", description: "Bare." },
          ]),
        ),
      );

      assert.deepEqual(tools, [
        { name: "whoami", description: "Who am I.", parameters: [] },
        { name: "broken", description: "Broken." },
        { name: "odd", description: "Odd." },
        { name: "bare", description: "Bare." },
      ]);
    }),
);

it.effect("a tool's arguments are gathered through `allOf` and the schema's own references", () =>
  Effect.gen(function* () {
    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(
        listingServer([
          {
            name: "search",
            description: "Searches.",
            inputSchema: {
              type: "object",
              allOf: [
                { $ref: "#/$defs/Scope" },
                { properties: { query: { type: "string" } }, required: ["query"] },
              ],
              $defs: {
                Scope: {
                  type: "object",
                  properties: { team: { $ref: "#/$defs/Team", description: "Which team." } },
                  required: ["team"],
                },
                Team: { type: "string", enum: ["core", "web"], default: "core" },
              },
            },
          },
        ]),
      ),
    );

    assert.deepEqual(tools[0]?.parameters, [
      {
        name: "team",
        type: "enum",
        required: true,
        description: "Which team.",
        values: ["core", "web"],
        default: "core",
      },
      { name: "query", type: "string", required: true },
    ]);
  }),
);

it.effect(
  "a schema that is no object's, offers alternatives at its root, or points elsewhere says nothing of its arguments",
  () =>
    Effect.gen(function* () {
      const unreadable = [
        { type: "string" },
        { type: ["array", "null"] },
        { anyOf: [{ type: "object", properties: {} }, { type: "null" }] },
        { $ref: "https://schemas.example.test/search.json" },
        { type: "object", allOf: [{ $ref: "#/$defs/Missing" }] },
      ];
      const tools = yield* listMcpTools(URL, TOKEN).pipe(
        Effect.provide(
          listingServer(
            unreadable.map((inputSchema, index) => ({
              name: `tool_${index}`,
              description: "A tool.",
              inputSchema,
            })),
          ),
        ),
      );

      assert.deepEqual(
        tools.map((tool) => tool.parameters),
        unreadable.map(() => undefined),
      );
    }),
);

it.effect(
  "an argument's values and default are kept as the server wrote them, edge spaces included",
  () =>
    Effect.gen(function* () {
      const tools = yield* listMcpTools(URL, TOKEN).pipe(
        Effect.provide(
          listingServer([
            {
              name: "join",
              description: "Joins.",
              inputSchema: {
                type: "object",
                properties: { separator: { type: "string", enum: [" ", "", ", "], default: " " } },
              },
            },
          ]),
        ),
      );

      assert.deepEqual(tools[0]?.parameters, [
        { name: "separator", type: "enum", required: false, values: [" ", "", ", "], default: " " },
      ]);
    }),
);

it.effect(
  "an argument that refers to itself is read as far as it goes, and the list still answers",
  () =>
    Effect.gen(function* () {
      const tools = yield* listMcpTools(URL, TOKEN).pipe(
        Effect.provide(
          listingServer([
            {
              name: "pick",
              description: "Picks.",
              inputSchema: {
                type: "object",
                properties: { choice: { $ref: "#/$defs/Choice" } },
                $defs: { Choice: { anyOf: [{ $ref: "#/$defs/Choice" }, { type: "null" }] } },
              },
            },
            { name: "after", description: "Listed after it." },
          ]),
        ),
      );

      assert.deepEqual(
        tools.map((tool) => tool.name),
        ["pick", "after"],
      );
      assert.equal(tools[0]?.parameters?.[0]?.name, "choice");
      assert.equal(tools[0]?.parameters?.[0]?.values, undefined);
    }),
);

it.effect(
  "an argument meets every schema it is given: each declaration, what it refers to, and its allOf",
  () =>
    Effect.gen(function* () {
      const tools = yield* listMcpTools(URL, TOKEN).pipe(
        Effect.provide(
          listingServer([
            {
              name: "run",
              description: "Runs.",
              inputSchema: {
                type: "object",
                allOf: [
                  { properties: { mode: { type: "string" } } },
                  { properties: { mode: { enum: ["safe"] } }, required: ["mode"] },
                ],
                properties: {
                  speed: { $ref: "#/$defs/Speed", enum: ["slow"] },
                  id: { allOf: [{ description: "An identifier." }, { type: "string" }] },
                },
                $defs: {
                  Speed: { type: "string", enum: ["slow", "fast"], description: "How fast." },
                },
              },
            },
          ]),
        ),
      );

      assert.deepEqual(tools[0]?.parameters, [
        {
          name: "speed",
          type: "enum",
          required: false,
          description: "How fast.",
          values: ["slow"],
        },
        { name: "id", type: "string", required: false, description: "An identifier." },
        { name: "mode", type: "enum", required: true, values: ["safe"] },
      ]);
    }),
);

it.effect("a tool keeps a bounded number of arguments, each bounded", () =>
  Effect.gen(function* () {
    const properties = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `arg${index}`,
        { type: "string", description: "d".repeat(900) },
      ]),
    );
    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(
        listingServer([
          { name: "sprawl", description: "Sprawls.", inputSchema: { type: "object", properties } },
        ]),
      ),
    );

    const parameters = tools[0]?.parameters ?? [];
    assert.equal(parameters.length, 64);
    assert.equal(parameters[0]?.description?.length, 500);
    assert.ok(parameters[0]?.description?.endsWith("…"));
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
