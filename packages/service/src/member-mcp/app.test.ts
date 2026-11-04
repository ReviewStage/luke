import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { openWorkspace } from "@repo/database/testing";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { settleJsonSchemaGolden } from "@repo/wire/testing";
import { Effect, Schema } from "effect";
import { afterEach, vi } from "vitest";
import { DESKTOP_OAUTH_CLIENT } from "../auth/oauth-clients.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  connected,
  MCP_CLIENT,
  MEMBER_MCP_TEST,
  memberMcpStanding,
  mintedToken,
  OTHER_RESOURCE,
  post,
  RESOURCE,
  REVISION,
  signUp,
} from "../testing/member-mcp-auth.js";
import { MEMBER_MCP_METADATA_ROUTE, memberMcpIssuer } from "./app.js";
import { MEMBER_MCP_PATH, MEMBER_MCP_SCOPE } from "./resource.js";
import { LIST_WORKSPACES_TOOL } from "./tools.js";

/**
 * The member MCP server, answered by its group the way a function answers
 * it, over the auth service and the migrated PGlite the tools read too
 * (`../testing/member-mcp-auth.ts`). The tokens are the provider's own,
 * minted through a seeded test client linked to the resource: a signed-up
 * account authorizes it, as a client's sign-in does, and the client
 * exchanges its code. The SDK's own client drives the server at both
 * revisions it serves.
 */

const ORIGIN = MEMBER_MCP_TEST.ORIGIN;

const decodeMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    resource: Schema.String,
    authorization_servers: Schema.Array(Schema.String),
    scopes_supported: Schema.Array(Schema.String),
    bearer_methods_supported: Schema.Array(Schema.String),
  }),
);
const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaces: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        slug: Schema.String,
        name: Schema.String,
        role: Schema.String,
      }),
    ),
  }),
);

/** The JSON Schema goldens of this package, where a tool's input a model is shown is recorded. */
const GOLDEN_ROOT = path.join(fileURLToPath(import.meta.url), "../../../fixtures/json-schema");

afterEach(() => {
  vi.restoreAllMocks();
});

/** The server over its seeded rows, as every test here stands it up. */
const standing = memberMcpStanding();

/** The metadata document's address a challenge must name for the resource (RFC 9728). */
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource${MEMBER_MCP_PATH}`;

it.effect(
  "no token, the desktop's opaque token, and a token for another resource are each refused with the challenge naming the metadata; a token without the scope is refused for its scope; a browser's origin is refused",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const { cookie } = yield* Effect.promise(() => signUp(auth));
      const desktop = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: DESKTOP_OAUTH_CLIENT.id,
          scope: DESKTOP_OAUTH_CLIENT.scopes,
        }),
      );
      const elsewhere = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: OTHER_RESOURCE,
        }),
      );
      const unscoped = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );

      for (const bearer of [undefined, desktop, elsewhere]) {
        const refused = yield* post(fetch, bearer);
        assert.equal(refused.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.equal(refused.challenge, `Bearer resource_metadata="${METADATA_URL}"`);
      }
      const forbidden = yield* post(fetch, unscoped);
      assert.equal(forbidden.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      assert.match(
        forbidden.challenge ?? "",
        /^Bearer error="insufficient_scope", scope="vespin:mcp"/u,
      );
      const page = yield* post(fetch, undefined, "https://page.test");
      assert.equal(page.status, HOSTED_HTTP_STATUS.FORBIDDEN);
    }),
);

it.effect.each(Object.values(REVISION))(
  "an SDK client at %s lists list_workspaces as the golden shows it and runs it as the member",
  (revision) =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const { userId, cookie } = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* openWorkspace(userId).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );
      const { client, transport } = yield* connected(fetch, token, revision);

      const listed = yield* Effect.promise(() => client.listTools());
      const called = yield* Effect.promise(() =>
        client.callTool({ name: LIST_WORKSPACES_TOOL.name, arguments: {} }),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(transport.protocolVersion, revision);
      const golden = JSON.parse(
        yield* Effect.promise(() =>
          fs.readFile(path.join(GOLDEN_ROOT, "list-workspaces-input.json"), "utf8"),
        ),
      );
      assert.deepEqual(
        listed.tools.map(({ name, inputSchema }) => ({ name, inputSchema })),
        [{ name: LIST_WORKSPACES_TOOL.name, inputSchema: golden }],
      );
      assert.notEqual(called.isError, true, JSON.stringify(called));
      const [content] = called.content;
      assert.ok(content?.type === "text");
      assert.deepEqual(decodeListed(JSON.parse(content.text)), {
        workspaces: [
          {
            id: workspaceId,
            slug: `workspace-${workspaceId}`,
            name: "Test Workspace",
            role: WORKSPACE_ROLE.OWNER,
          },
        ],
      });
    }),
);

it.effect("the metadata names the resource, the auth service, the scopes, and the header", () =>
  Effect.gen(function* () {
    const { fetch } = yield* standing;
    const answered = yield* Effect.promise(() => fetch(`${ORIGIN}${MEMBER_MCP_METADATA_ROUTE}`));
    assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
    const metadata = decodeMetadata(yield* Effect.promise(() => answered.json()));
    assert.equal(metadata.resource, RESOURCE);
    assert.deepEqual(metadata.authorization_servers, [memberMcpIssuer(ORIGIN)]);
    assert.deepEqual(metadata.scopes_supported, Object.values(MEMBER_MCP_SCOPE));
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
  }),
);

it("list_workspaces shows the model the recorded input", async () => {
  await settleJsonSchemaGolden(GOLDEN_ROOT, "list-workspaces-input", LIST_WORKSPACES_TOOL.input);
});
