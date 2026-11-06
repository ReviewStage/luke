import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { afterEach, vi } from "vitest";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { MEMBER_MCP_SCOPE } from "../member-mcp/resource.js";
import {
  allowConsent,
  authorize,
  authorizeAnswer,
  connected,
  exchangeCode,
  MEMBER_MCP_TEST,
  type MemberMcpTestAuth,
  memberMcpStanding,
  mintedToken,
  post,
  RESOURCE,
  REVISION,
  register,
  registration,
  signUp,
} from "../testing/member-mcp-auth.js";
import { AUTH_SERVER_METADATA_PATHS } from "./auth-app.js";
import { AUTH_BASE_PATH } from "./auth-policy.js";
import { oauthUserInfoFromAuthAnswer, requestUserId, type UserInfoEndpoint } from "./bearer.js";
import { DESKTOP_OAUTH_CLIENT } from "./oauth-clients.js";

const ORIGIN = MEMBER_MCP_TEST.ORIGIN;
const AUTH = `${ORIGIN}${AUTH_BASE_PATH}`;

const MCP_SCOPES = [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS] as const;

const CIMD_CLIENT = {
  ID: "https://client.example/.well-known/oauth-client-metadata.json",
  OPENID_ID: "https://client.example/.well-known/openid-client-metadata.json",
} as const;

function metadataDocument(clientId: string, scope?: string) {
  return {
    client_id: clientId,
    client_name: "A client named by its document",
    redirect_uris: [MEMBER_MCP_TEST.LOOPBACK],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...(scope === undefined ? undefined : { scope }),
  };
}

const CIMD_DOCUMENTS: ReadonlyMap<string, object> = new Map([
  [CIMD_CLIENT.ID, metadataDocument(CIMD_CLIENT.ID)],
  [CIMD_CLIENT.OPENID_ID, metadataDocument(CIMD_CLIENT.OPENID_ID, "openid")],
]);

function fetchMetadataDocument(input: RequestInfo | URL): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const document = CIMD_DOCUMENTS.get(url);
  if (document === undefined) {
    return Promise.reject(new Error(`this test publishes no document at ${url}`));
  }
  return Promise.resolve(
    new Response(JSON.stringify(document), { headers: { "content-type": "application/json" } }),
  );
}

const decodeRegistered = Schema.decodeUnknownSync(
  Schema.Struct({ client_id: Schema.String, scope: Schema.String }),
);
const decodeRefusal = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }));
const decodeClaims = Schema.decodeUnknownSync(
  Schema.Struct({
    aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
    scope: Schema.String,
  }),
);
const decodeAuthServerMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    issuer: Schema.String,
    registration_endpoint: Schema.String,
    client_id_metadata_document_supported: Schema.Boolean,
    token_endpoint_auth_methods_supported: Schema.Array(Schema.String),
    scopes_supported: Schema.Array(Schema.String),
  }),
);

function claimsOf(token: string) {
  const [, payload] = token.split(".");
  return decodeClaims(JSON.parse(Buffer.from(payload ?? "", "base64url").toString()));
}

function userInfoOver(auth: MemberMcpTestAuth): UserInfoEndpoint {
  return (input) =>
    Effect.tryPromise(async () => {
      const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
      return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
    });
}

function accountOf(auth: MemberMcpTestAuth, token: string) {
  return requestUserId(
    new Request(`${ORIGIN}/api/account`, { headers: { authorization: `Bearer ${token}` } }),
    userInfoOver(auth),
    () => Effect.succeedNone,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

const standing = memberMcpStanding({ fetchClientMetadataResource: fetchMetadataDocument });

it.effect(
  "a client named by its metadata document and one registered dynamically each sign in through consent for the server alone: the token names the server and enters it, and names nobody at an account route",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const { cookie } = yield* Effect.promise(() => signUp(auth));
      const registered = yield* Effect.promise(() => register(auth, registration(MCP_SCOPES)));
      assert.equal(registered.status, HOSTED_HTTP_STATUS.CREATED, yield* text(registered));
      const dynamic = decodeRegistered(yield* Effect.promise(() => registered.json()));
      assert.equal(dynamic.scope, MCP_SCOPES.join(" "));

      for (const clientId of [CIMD_CLIENT.ID, dynamic.client_id]) {
        const grant = { clientId, scope: MCP_SCOPES, resource: RESOURCE };
        const asked = yield* Effect.promise(() => authorize(auth, cookie, grant));
        assert.equal(asked.pathname, MEMBER_MCP_TEST.CONSENT_PAGE, asked.href);
        assert.equal(asked.searchParams.get("client_id"), clientId);
        const landed = yield* Effect.promise(() => allowConsent(auth, cookie, asked));
        const token = yield* Effect.promise(() => exchangeCode(auth, grant, landed));

        const claims = claimsOf(token);
        assert.deepEqual([claims.aud].flat(), [RESOURCE]);
        assert.deepEqual(claims.scope.split(" ").sort(), [...MCP_SCOPES].sort());
        const { client } = yield* connected(fetch, token, REVISION.MODERN);
        yield* Effect.promise(() => client.close());
        assert.ok(Option.isNone(yield* accountOf(auth, token)), `${clientId} named an account`);
      }
    }),
);

it.effect(
  "neither door grants openid, a client of either asks it in vain, and the desktop's token for the server is refused there for its scope",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const { cookie } = yield* Effect.promise(() => signUp(auth));

      const refused = yield* Effect.promise(() => register(auth, registration(["openid"])));
      assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      assert.equal(
        decodeRefusal(yield* Effect.promise(() => refused.json())).error,
        "invalid_scope",
      );
      const registered = yield* Effect.promise(() => register(auth, registration(MCP_SCOPES)));
      const dynamic = decodeRegistered(yield* Effect.promise(() => registered.json()));

      const unnamed = yield* Effect.promise(() =>
        authorizeAnswer(auth, cookie, {
          clientId: CIMD_CLIENT.OPENID_ID,
          scope: ["openid"],
          resource: RESOURCE,
        }),
      );
      assert.equal(unnamed.status, HOSTED_HTTP_STATUS.BAD_REQUEST, yield* text(unnamed));
      assert.equal(
        decodeRefusal(yield* Effect.promise(() => unnamed.json())).error,
        "invalid_scope",
      );
      for (const clientId of [CIMD_CLIENT.ID, dynamic.client_id]) {
        const landed = yield* Effect.promise(() =>
          authorize(auth, cookie, { clientId, scope: ["openid"], resource: RESOURCE }),
        );
        assert.equal(landed.searchParams.get("error"), "invalid_scope", landed.href);
        assert.equal(landed.searchParams.get("code"), null);
      }

      const desktop = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: DESKTOP_OAUTH_CLIENT.id,
          scope: DESKTOP_OAUTH_CLIENT.scopes,
          resource: RESOURCE,
        }),
      );
      const forbidden = yield* post(fetch, desktop);
      assert.equal(forbidden.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      assert.match(forbidden.challenge ?? "", /^Bearer error="insufficient_scope"/u);
    }),
);

it.effect(
  "the authorization server's metadata is answered at the path each well-known one is carried as, naming registration, metadata documents, and public clients",
  () =>
    Effect.gen(function* () {
      const { auth } = yield* standing;
      for (const { carried } of AUTH_SERVER_METADATA_PATHS) {
        const answered = yield* Effect.promise(() =>
          auth.handler(new Request(`${ORIGIN}${carried}`)),
        );
        assert.equal(
          answered.status,
          HOSTED_HTTP_STATUS.OK,
          `${carried}: ${yield* text(answered)}`,
        );
        const metadata = decodeAuthServerMetadata(yield* Effect.promise(() => answered.json()));
        assert.equal(metadata.issuer, AUTH);
        assert.equal(metadata.registration_endpoint, `${AUTH}/oauth2/register`);
        assert.equal(metadata.client_id_metadata_document_supported, true);
        assert.ok(metadata.token_endpoint_auth_methods_supported.includes("none"));
        assert.ok(metadata.scopes_supported.includes(MEMBER_MCP_SCOPE.MCP));
      }
    }),
);

function text(answer: Response): Effect.Effect<string> {
  return Effect.promise(() => answer.clone().text());
}
