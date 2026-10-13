import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { listMcpTools, MCP_TOOLS_FAILURE } from "../server/hosted/mcp-tools";
import { mcpServerFake } from "./support/mcp-server-fake";

/**
 * A provider's tools as an MCP client reads them, over a scripted server:
 * the session opened and ended, every page read, either answer shape, and
 * the one word a refusal or a shapeless answer is.
 */

const URL = "https://mcp.example.test/mcp";
const TOKEN = "lin_oauth_fixture";

it.effect("the session is opened, every page is read, and the session is ended", () =>
  Effect.gen(function* () {
    const server = mcpServerFake({
      token: TOKEN,
      pages: [
        [{ name: "list_issues", description: "List issues.\nReturns at most fifty." }],
        [{ name: "create_issue" }],
      ],
    });

    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(fakeHttpClientLayer(server.respond)),
    );
    assert.deepEqual(tools, [
      { name: "list_issues", description: "List issues." },
      { name: "create_issue", description: "" },
    ]);
    assert.deepEqual(server.methods, [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/list",
      "DELETE",
    ]);
  }),
);

it.effect("a server that answers as an event stream is read the same", () =>
  Effect.gen(function* () {
    const server = mcpServerFake({
      token: TOKEN,
      eventStream: true,
      pages: [[{ name: "search", description: "Search pages." }]],
    });

    const tools = yield* listMcpTools(URL, TOKEN).pipe(
      Effect.provide(fakeHttpClientLayer(server.respond)),
    );
    assert.deepEqual(tools, [{ name: "search", description: "Search pages." }]);
  }),
);

it.effect(
  "a refused bearer is refused, and a shapeless answer unreadable, each by its word alone",
  () =>
    Effect.gen(function* () {
      const refusing = mcpServerFake({ token: "someone-else", pages: [] });
      const refused = yield* Effect.flip(
        listMcpTools(URL, TOKEN).pipe(Effect.provide(fakeHttpClientLayer(refusing.respond))),
      );
      assert.equal(refused.reason, MCP_TOOLS_FAILURE.REFUSED);

      const shapeless = yield* Effect.flip(
        listMcpTools(URL, TOKEN).pipe(
          Effect.provide(
            fakeHttpClientLayer(() => new Response("<html>a login page</html>", { status: 200 })),
          ),
        ),
      );
      assert.equal(shapeless.reason, MCP_TOOLS_FAILURE.UNREADABLE);
    }),
);
