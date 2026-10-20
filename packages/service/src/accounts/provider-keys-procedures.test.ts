import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";
import { it } from "@effect/vitest";
import { chatGptSignIn } from "@luke/credentials";
import { loopbackConsent } from "@luke/credentials/node";
import {
  CHATGPT_FAKE,
  fakeChatGptAuthorizationServer,
  grantedCallback,
  returnToLoopback,
  signingKeysAnswer,
} from "@luke/credentials/testing";
import { Database } from "@luke/database/core/query";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import {
  type ChatGptCredentialsSaveRequest,
  chatGptHostAnswerSchema,
  FAST_ACCESS,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeysAnswer,
  providerKeysAnswerSchema,
} from "@luke/features/provider-key-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { providerKeysProcedures } from "./provider-keys-procedures.js";

/**
 * The account's own provider keys, answered by the procedures the way the
 * hosted oRPC route answers them, over a real dialect and a provider faked at its HTTP door:
 * a key is kept only once its provider accepts it, kept sealed, answered
 * only as a hint, and never logged, an Anthropic key with whether its
 * organization may run fast mode; the bearer names the account and
 * nothing else does.
 *
 * Synthetic accounts, bearers, and keys throughout; the key-encryption keys
 * are fixed bytes written for this file.
 */

const ORIGIN = "https://luke.test";
const KEYS_PATH = "/api/account/provider-keys";

const KEK = {
  ONE: `1:${Buffer.alloc(32, 1).toString("base64")}`,
  OTHER: `1:${Buffer.alloc(32, 7).toString("base64")}`,
} as const;

const KEY = {
  ANTHROPIC: "sk-ant-api03-test-key-0000000000000000wxyz",
  OPENAI: "sk-proj-test-key-00000000000000000000abcd",
} as const;

const PROVIDER_URL = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: "https://api.anthropic.com/v1/models?limit=1",
  [PROVIDER_KEY_PROVIDER.OPENAI]: "https://api.openai.com/v1/models",
} as const;

/** OpenAI's authorization server, which a ChatGPT sign-in's removal reaches. */
const AUTH_ORIGIN = "https://auth.openai.com";
const REVOCATION_URL = `${AUTH_ORIGIN}/oauth/revoke`;
const DISCOVERY_URL = `${AUTH_ORIGIN}/.well-known/openid-configuration`;
const JWKS_URL = `${AUTH_ORIGIN}/.well-known/jwks.json`;

/** A signing key of the fake OpenAI's, generated for this file: its id, its private half, and its public half as a JWK. */
function signingKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { kty = "", n = "", e = "" } = publicKey.export({ format: "jwk" });
  return { kid, privateKey, jwk: { kty, n, e, kid, alg: "RS256" } };
}

const OPENAI_KEY = signingKey("openai-key-1");
const ROTATED_KEY = signingKey("openai-key-2");
const FORGED_KEY = signingKey("openai-key-1");

/** An RS256 JWT of the claims, signed by the key given and naming its id. */
function signedJwt(
  claims: Record<string, WireBoundaryInput>,
  key: { kid: string; privateKey: KeyObject },
) {
  const part = (value: WireBoundaryInput) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${part({ alg: "RS256", kid: key.kid, typ: "JWT" })}.${part(claims)}`;
  return `${signed}.${sign("RSA-SHA256", Buffer.from(signed), key.privateKey).toString("base64url")}`;
}

/** OpenAI's authorization server as a save and a removal reach it: discovery, the published keys, and a revocation that succeeds. */
const openAiAuth =
  (published: readonly { jwk: Record<string, string> }[] = [OPENAI_KEY]) =>
  (request: RecordedRequest): Response => {
    if (request.url === DISCOVERY_URL) {
      return jsonResponse({ revocation_endpoint: REVOCATION_URL, jwks_uri: JWKS_URL });
    }
    if (request.url === JWKS_URL) return jsonResponse({ keys: published.map(({ jwk }) => jwk) });
    return new Response(null, { status: HTTP_STATUS.OK });
  };

/** Where Anthropic is asked whether a key's organization may run fast mode. */
const FAST_CHECK_URL = "https://api.anthropic.com/v1/messages";

/** Anthropic's refusal of a fast request for an organization fast mode was never enabled for, as production met it. */
const FAST_LIMIT_ZERO = {
  type: "error",
  error: {
    type: "rate_limit_error",
    message:
      "This request would exceed your organization's rate limit of 0 fast mode input tokens per minute (model: claude-opus-5-5).",
  },
};

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  nativeAgentAccounts: [],
  agentSandboxSnapshot: undefined,
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
  /** The answer's bytes as they crossed, for what must never be in them. */
  readonly text: string;
}

/** What the fake provider answers a check with, per key; a key it does not know is refused. */
type ProviderAnswers = ReadonlyMap<string, number>;

const ACCEPTING: ProviderAnswers = new Map([
  [KEY.ANTHROPIC, HTTP_STATUS.OK],
  [KEY.OPENAI, HTTP_STATUS.OK],
]);

/** The key a recorded check carried, read from whichever header its provider reads. */
function keyOf(headers: Headers): string {
  return headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
}

/** What a fast check asks Anthropic for: the model, at fast speed, for one token. */
const readFastCheck = Schema.decodeUnknownSync(
  Schema.Struct({ model: Schema.String, max_tokens: Schema.Number, speed: Schema.String }),
);

/** How the fake Anthropic answers a fast request, per key: run where the key is not named here. */
type FastAnswers = ReadonlyMap<string, Response>;

/** Two accounts behind their own bearers, a provider, and the procedures answering under the ring given. */
const openAccounts = (
  options: {
    ring?: string;
    provider?: ProviderAnswers;
    fast?: FastAnswers;
    /** OpenAI's authorization server, where a test reaches it. */
    auth?: (request: RecordedRequest) => Response;
  } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
    for (const id of [owner, other]) {
      yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
    }
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const answers = options.provider ?? ACCEPTING;
    const provider = recordingHttpClient((request) =>
      new URL(request.url).origin === AUTH_ORIGIN
        ? (options.auth ?? openAiAuth())(request)
        : request.url === FAST_CHECK_URL
          ? (options.fast?.get(keyOf(request.headers))?.clone() ?? jsonResponse({}))
          : jsonResponse({}, answers.get(keyOf(request.headers)) ?? HTTP_STATUS.UNAUTHORIZED),
    );
    const logged: string[] = [];
    const procedures = providerKeysProcedures({
      resolveUserId: (incoming) =>
        Effect.succeed(
          Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
        ),
    });
    const ask = (request: Request, ring = options.ring) =>
      answer(procedures, request, { ring, provider: provider.layer, logged });
    return { owner, other, ask, checks: provider.requests, logged };
  });

const answer = (
  procedures: ReturnType<typeof providerKeysProcedures>,
  request: Request,
  seams: {
    readonly ring: string | undefined;
    readonly provider: ReturnType<typeof recordingHttpClient>["layer"];
    readonly logged: string[];
  },
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const environment: HostedEnvironmentValues = {
      ...NO_ENVIRONMENT,
      providerKeyEncryptionKeys: seams.ring === undefined ? undefined : Redacted.make(seams.ring),
    };
    // Every line the handler logs is kept, so the test can read what it says.
    const recorder = Logger.make(({ message, cause }) => {
      seams.logged.push(`${JSON.stringify(message)} ${Cause.pretty(cause)}`);
    });
    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, environment),
      seams.provider,
      Logger.layer([recorder]),
    );
    const response = yield* hostedAnswer({ account: procedures }, services, request);
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body, text } satisfies Answer;
  });

function request(
  userId: string | undefined,
  init: { method?: string; body?: WireBoundaryInput; query?: string; path?: string } = {},
) {
  const url = new URL(init.path ?? KEYS_PATH, ORIGIN);
  if (init.query !== undefined) url.search = init.query;
  return new Request(url, {
    method: init.method ?? "GET",
    headers: {
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
      ...(init.body === undefined ? undefined : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

const save = (userId: string, provider: ProviderKeyProvider, key: string) =>
  request(userId, { method: "PUT", body: { provider, key } });

const remove = (userId: string, provider: string, kind?: string) =>
  request(userId, {
    method: "DELETE",
    query: kind === undefined ? `provider=${provider}` : `provider=${provider}&kind=${kind}`,
  });

/** A Claude setup-token as `claude setup-token` prints one: an OAuth token's prefix, synthetic throughout. */
const SETUP_TOKEN = "sk-ant-oat01-test-setup-token-000000000000000000000000tokn";

const saveToken = (userId: string, provider: ProviderKeyProvider, key: string) =>
  request(userId, {
    method: "PUT",
    body: { provider, key, kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN },
  });

const ISSUED_CLIENT = "oaiapp_test_client";
const CHATGPT_SUBJECT = "chatgpt-subject-0000";

/** An ID token's claims as OpenAI issues them for the sign-in below, expiring long after any test's clock. */
const ID_CLAIMS = {
  iss: AUTH_ORIGIN,
  aud: ISSUED_CLIENT,
  sub: CHATGPT_SUBJECT,
  exp: 4_000_000_000,
} as const;

/** An access token's claims as OpenAI documents them for this flow; no expiry, so the answered lifetime stands. */
const ACCESS_CLAIMS = {
  iss: AUTH_ORIGIN,
  aud: "https://api.openai.com/v1",
  client_id: ISSUED_CLIENT,
  sub: "opaque-subject",
} as const;

/** A JWT of the claims with a signature nothing checks, as a save reads an access token's claims unsigned. */
function unsignedJwt(claims: Record<string, WireBoundaryInput>) {
  const part = (value: WireBoundaryInput) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.unchecked-signature`;
}

/** A ChatGPT sign-in as the desktop hands one over, synthetic throughout, its ID token signed by the fake OpenAI. */
const SIGN_IN = {
  clientId: ISSUED_CLIENT,
  accountId: CHATGPT_SUBJECT,
  accessToken: unsignedJwt(ACCESS_CLAIMS),
  refreshToken: "test-refresh-token-0000000000000000000ref",
  idToken: signedJwt(ID_CLAIMS, OPENAI_KEY),
  expiresInSeconds: 3600,
  scopes: ["chatgpt.tokens.use.direct", "offline_access", "openid"],
} as const;

/** What of a sign-in must never leave the seal. */
const SIGN_IN_SECRETS = [SIGN_IN.accessToken, SIGN_IN.refreshToken, SIGN_IN.idToken];

const CREDENTIALS_PATH = "/api/account/chatgpt/credentials";
const HOST_PATH = "/api/account/chatgpt/host";

const saveSignIn = (userId: string, overrides: Record<string, WireBoundaryInput> = {}) =>
  request(userId, { method: "PUT", path: CREDENTIALS_PATH, body: { ...SIGN_IN, ...overrides } });

const removeSignIn = (userId: string) =>
  remove(userId, PROVIDER_KEY_PROVIDER.OPENAI, PROVIDER_KEY_KIND.CHATGPT_OAUTH);

const readHost = (body: WireBoundaryInput) => {
  const read = readEither(chatGptHostAnswerSchema)(unparsedWire(body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
};

/** The answer as the wire reads it, failing the test where it is not the wire's. */
function keysOf(answered: Answer): ProviderKeysAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(providerKeysAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

const refusal = (status: number, error: string) => ({ status, body: { error } });

it.layer(getTestDB())("the provider keys route", (it) => {
  it.effect(
    "a key the provider accepts is kept and answered as its hint, verified, at the instant it was saved, and never as itself",
    () =>
      Effect.gen(function* () {
        const { owner, ask, checks } = yield* openAccounts({ ring: KEK.ONE });
        yield* TestClock.adjust("1 hour");
        const savedAt = yield* Clock.currentTimeMillis;

        const saved = yield* ask(save(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, KEY.ANTHROPIC));
        const read = yield* ask(request(owner));

        assert.deepEqual(keysOf(saved), {
          keys: [
            {
              provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
              hint: "sk-ant-…wxyz",
              addedAt: savedAt,
              status: PROVIDER_KEY_STATUS.VERIFIED,
              statusAt: savedAt,
            },
          ],
        });
        assert.deepEqual(keysOf(read), keysOf(saved));
        for (const answered of [saved, read]) assert.ok(!answered.text.includes(KEY.ANTHROPIC));
        assert.deepEqual(
          checks.map((check) => [check.url, keyOf(check.headers)]).sort(),
          [
            [FAST_CHECK_URL, KEY.ANTHROPIC],
            [PROVIDER_URL[PROVIDER_KEY_PROVIDER.ANTHROPIC], KEY.ANTHROPIC],
          ],
          "the provider is asked once whether it accepts the key and once about fast mode, with the key",
        );
      }),
  );

  it.effect(
    "an Anthropic key is kept with whether its organization runs fast mode: enabled where a fast request runs, not enabled at a fast limit of 0, and unsaid where the answer says neither; an OpenAI key is never asked",
    () =>
      Effect.gen(function* () {
        const notEnabled = "sk-ant-api03-no-fast-00000000000000000nfst";
        const unsaid = "sk-ant-api03-fast-500-0000000000000000f500";
        const options = {
          ring: KEK.ONE,
          provider: new Map([
            [KEY.ANTHROPIC, HTTP_STATUS.OK],
            [KEY.OPENAI, HTTP_STATUS.OK],
            [notEnabled, HTTP_STATUS.OK],
            [unsaid, HTTP_STATUS.OK],
          ]),
          fast: new Map([
            [notEnabled, jsonResponse(FAST_LIMIT_ZERO, 429)],
            [unsaid, jsonResponse({}, HTTP_STATUS.SERVER_ERROR)],
          ]),
        };
        const { owner, other, ask, checks } = yield* openAccounts(options);
        const later = yield* openAccounts(options);

        keysOf(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, KEY.ANTHROPIC)));
        keysOf(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, KEY.OPENAI)));
        keysOf(yield* ask(save(other, PROVIDER_KEY_PROVIDER.ANTHROPIC, notEnabled)));
        keysOf(yield* later.ask(save(later.owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, unsaid)));

        const fastOf = (userId: string) =>
          Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY), (rows) =>
            rows.map((row) => [row.provider, row.fastAccess]),
          );
        assert.deepEqual(yield* fastOf(owner), [
          [PROVIDER_KEY_PROVIDER.ANTHROPIC, FAST_ACCESS.ENABLED],
          [PROVIDER_KEY_PROVIDER.OPENAI, null],
        ]);
        assert.deepEqual(yield* fastOf(other), [
          [PROVIDER_KEY_PROVIDER.ANTHROPIC, FAST_ACCESS.NOT_ENABLED],
        ]);
        assert.deepEqual(yield* fastOf(later.owner), [[PROVIDER_KEY_PROVIDER.ANTHROPIC, null]]);
        assert.ok(
          !checks.some(
            (check) => check.url === FAST_CHECK_URL && keyOf(check.headers) === KEY.OPENAI,
          ),
          "an OpenAI key is never sent to Anthropic",
        );
        const fastCheck = checks.find(
          (check) => check.url === FAST_CHECK_URL && keyOf(check.headers) === KEY.ANTHROPIC,
        );
        assert.equal(fastCheck?.headers.get("anthropic-beta"), "fast-mode-2026-02-01");
        const asked = yield* Effect.promise(() => new Response(fastCheck?.init.body).text());
        assert.deepEqual(readFastCheck(JSON.parse(asked)), {
          model: "claude-opus-5-5",
          max_tokens: 1,
          speed: "fast",
        });
      }),
  );

  it.effect("no column of the row holds the key, or its base64, in the clear", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { owner, ask } = yield* openAccounts({ ring: KEK.ONE });
      keysOf(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, KEY.OPENAI)));

      const rows = yield* db
        .select()
        .from(accountProviderKey)
        .where(eq(accountProviderKey.userId, owner));

      assert.equal(rows.length, 1);
      const stored = JSON.stringify(rows);
      assert.ok(!stored.includes(KEY.OPENAI));
      assert.ok(!stored.includes(Buffer.from(KEY.OPENAI).toString("base64")));
    }),
  );

  it.effect(
    "a key the provider refuses, one it cannot be asked about, and one spelled as the other provider's keep nothing and say why, and none is logged",
    () =>
      Effect.gen(function* () {
        const refused = "sk-ant-api03-refused-000000000000000000rfsd";
        const failing = "sk-proj-failing-0000000000000000000000fail";
        const { owner, ask, checks, logged } = yield* openAccounts({
          ring: KEK.ONE,
          provider: new Map([[failing, HTTP_STATUS.SERVER_ERROR]]),
        });

        const invalid = yield* ask(save(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, refused));
        const unreachable = yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, failing));
        const misplaced = yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, KEY.ANTHROPIC));
        const reversed = yield* ask(save(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, KEY.OPENAI));

        assert.deepEqual(keysOf(invalid), { keys: [], rejected: PROVIDER_KEY_REJECTION.INVALID });
        assert.deepEqual(keysOf(unreachable), {
          keys: [],
          rejected: PROVIDER_KEY_REJECTION.UNREACHABLE,
        });
        assert.deepEqual(keysOf(misplaced), {
          keys: [],
          rejected: PROVIDER_KEY_REJECTION.WRONG_PROVIDER,
        });
        assert.deepEqual(keysOf(reversed), {
          keys: [],
          rejected: PROVIDER_KEY_REJECTION.WRONG_PROVIDER,
        });
        assert.ok(
          checks.every((check) => keyOf(check.headers) !== KEY.ANTHROPIC),
          "an Anthropic key is never sent to OpenAI",
        );
        assert.ok(
          checks.every((check) => keyOf(check.headers) !== KEY.OPENAI),
          "an OpenAI key is never sent to Anthropic, not even to ask about fast mode",
        );
        for (const key of [refused, failing, KEY.ANTHROPIC]) {
          assert.ok(
            logged.every((line) => !line.includes(key)),
            "no line logs a key",
          );
          for (const answered of [invalid, unreachable, misplaced]) {
            assert.ok(!answered.text.includes(key));
          }
        }
      }),
  );

  it.effect(
    "a save replaces the provider's key, and a removal takes it out, for the bearer's account alone",
    () =>
      Effect.gen(function* () {
        const replacement = "sk-ant-api03-replacement-00000000000000repl";
        const { owner, other, ask } = yield* openAccounts({
          ring: KEK.ONE,
          provider: new Map([...ACCEPTING, [replacement, HTTP_STATUS.OK]]),
        });
        keysOf(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, KEY.ANTHROPIC)));
        keysOf(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, KEY.OPENAI)));
        yield* TestClock.adjust("1 day");

        const replaced = keysOf(
          yield* ask(save(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, replacement)),
        );
        const othersRead = keysOf(yield* ask(request(other)));
        const othersRemoval = keysOf(yield* ask(remove(other, PROVIDER_KEY_PROVIDER.OPENAI)));
        const removed = keysOf(yield* ask(remove(owner, PROVIDER_KEY_PROVIDER.OPENAI)));
        const removedTwice = keysOf(yield* ask(remove(owner, PROVIDER_KEY_PROVIDER.OPENAI)));

        assert.deepEqual(
          replaced.keys.map(({ provider, hint }) => [provider, hint]),
          [
            [PROVIDER_KEY_PROVIDER.ANTHROPIC, "sk-ant-…repl"],
            [PROVIDER_KEY_PROVIDER.OPENAI, "sk-proj-…abcd"],
          ],
        );
        assert.deepEqual(othersRead.keys, [], "another account holds none");
        assert.deepEqual(othersRemoval.keys, [], "another account removes none of the owner's");
        assert.deepEqual(
          removed.keys.map(({ provider }) => provider),
          [PROVIDER_KEY_PROVIDER.ANTHROPIC],
        );
        assert.deepEqual(removedTwice, removed);
      }),
  );

  it.effect(
    "a deployment without a ring, or with one it cannot read, is unavailable, and the log names the shape and never the value",
    () =>
      Effect.gen(function* () {
        const malformed = "1:not-a-key-at-all";
        const { owner, ask, logged } = yield* openAccounts();

        const none = yield* ask(request(owner));
        const unreadable = yield* ask(
          save(owner, PROVIDER_KEY_PROVIDER.OPENAI, KEY.OPENAI),
          malformed,
        );

        const unavailable = refusal(
          HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          HOSTED_API_ERROR.UNAVAILABLE,
        );
        assert.deepEqual({ status: none.status, body: none.body }, unavailable);
        assert.deepEqual({ status: unreadable.status, body: unreadable.body }, unavailable);
        assert.ok(logged.length > 0);
        assert.ok(logged.every((line) => !line.includes(malformed) && !line.includes(KEY.OPENAI)));
      }),
  );

  it.effect(
    "a body that is no save, a removal naming no provider, a bearer that names no account, and a method the path does not answer are refused",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts({ ring: KEK.ONE });
        const ofAnswer = (answered: Answer) => ({ status: answered.status, body: answered.body });
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(
          ofAnswer(
            yield* ask(
              request(owner, { method: "PUT", body: { provider: "google", key: KEY.OPENAI } }),
            ),
          ),
          invalid,
        );
        assert.deepEqual(
          ofAnswer(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, "sk-short"))),
          invalid,
        );
        assert.deepEqual(
          ofAnswer(
            yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, "sk-proj with spaces in the key")),
          ),
          invalid,
        );
        assert.deepEqual(ofAnswer(yield* ask(remove(owner, "google"))), invalid);
        assert.deepEqual(
          ofAnswer(yield* ask(request(undefined))),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          ofAnswer(yield* ask(request(owner, { method: "POST" }))),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect(
    "a save whose stated length is past a save's bound is refused as too large, and an unsigned one whatever it carries as unsigned",
    () =>
      Effect.gen(function* () {
        const { owner, ask, checks } = yield* openAccounts({ ring: KEK.ONE });
        const ofAnswer = (answered: Answer) => ({ status: answered.status, body: answered.body });
        const body = JSON.stringify({
          provider: PROVIDER_KEY_PROVIDER.OPENAI,
          key: "k".repeat(2_100),
        });
        const stated = (userId: string) =>
          new Request(new URL(KEYS_PATH, ORIGIN), {
            method: "PUT",
            headers: {
              authorization: `Bearer ${userId}`,
              "content-type": "application/json",
              "content-length": String(Buffer.byteLength(body)),
            },
            body,
          });

        assert.deepEqual(
          ofAnswer(yield* ask(stated(owner))),
          refusal(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
        );
        assert.deepEqual(
          ofAnswer(yield* ask(request(undefined, { method: "PUT", body: { nope: true } }))),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(checks, []);
      }),
  );
  it.effect(
    "a Claude setup-token is kept sealed and unverified as a subscription beside the keys, never sent to a provider, answered or logged, and removed by its kind for the bearer's account alone",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, other, ask, checks, logged } = yield* openAccounts({ ring: KEK.ONE });
        yield* TestClock.adjust("1 hour");
        const savedAt = yield* Clock.currentTimeMillis;

        const saved = yield* ask(saveToken(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, SETUP_TOKEN));
        const othersRead = keysOf(yield* ask(request(other)));
        const othersRemoval = keysOf(
          yield* ask(
            remove(other, PROVIDER_KEY_PROVIDER.ANTHROPIC, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN),
          ),
        );
        const keyRemoval = keysOf(yield* ask(remove(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC)));
        const stored = JSON.stringify(
          yield* db.select().from(accountProviderKey).where(eq(accountProviderKey.userId, owner)),
        );
        const removed = keysOf(
          yield* ask(
            remove(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN),
          ),
        );

        const subscription = {
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
          hint: "sk-ant-…tokn",
          addedAt: savedAt,
          status: PROVIDER_KEY_STATUS.UNVERIFIED,
          statusAt: savedAt,
        };
        assert.deepEqual(keysOf(saved), { keys: [], subscriptions: [subscription] });
        assert.deepEqual(othersRead, { keys: [] }, "another account reads none of it");
        assert.deepEqual(othersRemoval, { keys: [] }, "another account removes none of it");
        assert.deepEqual(
          keyRemoval,
          { keys: [], subscriptions: [subscription] },
          "a removal naming no kind takes an API key and leaves the subscription",
        );
        assert.deepEqual(removed, { keys: [] });
        assert.deepEqual(checks, [], "no provider is asked about a setup-token");
        assert.ok(!saved.text.includes(SETUP_TOKEN));
        assert.ok(!stored.includes(SETUP_TOKEN));
        assert.ok(!stored.includes(Buffer.from(SETUP_TOKEN).toString("base64")));
        assert.ok(logged.every((line) => !line.includes(SETUP_TOKEN)));
      }),
  );

  it.effect(
    "a setup-token is kept beside an Anthropic API key and an API key beside a setup-token, each removed by its own kind, and one spelled as no setup-token or saved for OpenAI keeps nothing",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask, checks, logged } = yield* openAccounts({ ring: KEK.ONE });
        keysOf(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, KEY.ANTHROPIC)));
        keysOf(yield* ask(saveToken(other, PROVIDER_KEY_PROVIDER.ANTHROPIC, SETUP_TOKEN)));
        const checksBefore = checks.length;

        const tokenBesideKey = keysOf(
          yield* ask(saveToken(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, SETUP_TOKEN)),
        );
        const checksAfterToken = checks.length;
        const keyBesideToken = keysOf(
          yield* ask(save(other, PROVIDER_KEY_PROVIDER.ANTHROPIC, KEY.ANTHROPIC)),
        );
        const checksAfterKey = checks.length;
        const tokenRemoved = keysOf(
          yield* ask(
            remove(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN),
          ),
        );
        const keyRemoved = keysOf(yield* ask(remove(other, PROVIDER_KEY_PROVIDER.ANTHROPIC)));
        const apiKeyAsToken = keysOf(
          yield* ask(saveToken(other, PROVIDER_KEY_PROVIDER.ANTHROPIC, KEY.ANTHROPIC)),
        );
        const forOpenAi = keysOf(
          yield* ask(saveToken(owner, PROVIDER_KEY_PROVIDER.OPENAI, SETUP_TOKEN)),
        );

        const keyHints = (answer: typeof tokenBesideKey) =>
          answer.keys.map(({ provider, hint }) => [provider, hint]);
        const tokenHints = (answer: typeof tokenBesideKey) =>
          answer.subscriptions?.map(({ provider, kind, hint }) => [provider, kind, hint]);
        const anthropicKey = [[PROVIDER_KEY_PROVIDER.ANTHROPIC, "sk-ant-…wxyz"]];
        const anthropicToken = [
          [PROVIDER_KEY_PROVIDER.ANTHROPIC, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN, "sk-ant-…tokn"],
        ];
        assert.equal(tokenBesideKey.rejected, undefined);
        assert.deepEqual(keyHints(tokenBesideKey), anthropicKey);
        assert.deepEqual(tokenHints(tokenBesideKey), anthropicToken);
        assert.equal(checksAfterToken, checksBefore, "no provider is asked about a setup-token");
        assert.equal(keyBesideToken.rejected, undefined);
        assert.ok(checksAfterKey > checksAfterToken, "the API key is checked with its provider");
        assert.deepEqual(keyHints(keyBesideToken), anthropicKey);
        assert.deepEqual(tokenHints(keyBesideToken), anthropicToken);
        assert.deepEqual(keyHints(tokenRemoved), anthropicKey, "the API key outlives the token");
        assert.equal(tokenRemoved.subscriptions, undefined);
        assert.deepEqual(keyRemoved.keys, [], "the token outlives the API key");
        assert.deepEqual(tokenHints(keyRemoved), anthropicToken);
        assert.deepEqual(apiKeyAsToken.rejected, PROVIDER_KEY_REJECTION.INVALID);
        assert.deepEqual(apiKeyAsToken.subscriptions, keyRemoved.subscriptions);
        assert.deepEqual(forOpenAi.rejected, PROVIDER_KEY_REJECTION.WRONG_PROVIDER);
        assert.equal(forOpenAi.subscriptions, undefined);
        assert.ok(logged.every((line) => !line.includes(SETUP_TOKEN)));
      }),
  );

  it.effect("setup-token saves are braked with key saves, ten an hour per account", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts({ ring: KEK.ONE });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        keysOf(yield* ask(saveToken(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, SETUP_TOKEN)));
      }

      const braked = keysOf(
        yield* ask(saveToken(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC, SETUP_TOKEN)),
      );
      const othersSave = keysOf(
        yield* ask(saveToken(other, PROVIDER_KEY_PROVIDER.ANTHROPIC, SETUP_TOKEN)),
      );

      assert.equal(braked.rejected, PROVIDER_KEY_REJECTION.TOO_MANY_TRIES);
      assert.equal(othersSave.rejected, undefined);
    }),
  );

  it.effect(
    "a ChatGPT sign-in the desktop hands over is kept sealed and answered under subscriptions as its hint alone, and none of it is answered, logged, or stored in the clear",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, other, ask, checks, logged } = yield* openAccounts({ ring: KEK.ONE });
        yield* TestClock.adjust("1 hour");
        const savedAt = yield* Clock.currentTimeMillis;

        const saved = yield* ask(saveSignIn(owner));
        const othersRead = keysOf(yield* ask(request(other)));

        assert.deepEqual(keysOf(saved), {
          keys: [],
          subscriptions: [
            {
              provider: PROVIDER_KEY_PROVIDER.OPENAI,
              kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
              hint: "ChatGPT",
              addedAt: savedAt,
              status: PROVIDER_KEY_STATUS.UNVERIFIED,
              statusAt: savedAt,
            },
          ],
        });
        assert.deepEqual(othersRead, { keys: [] });
        assert.ok(
          checks.every(
            (check) => check.method === "GET" && [DISCOVERY_URL, JWKS_URL].includes(check.url),
          ),
          "a save only reads OpenAI's published keys, and sends it no credential",
        );
        const rows = yield* db
          .select()
          .from(accountProviderKey)
          .where(eq(accountProviderKey.userId, owner));
        assert.equal(rows[0]?.accessExpiresAt?.getTime(), savedAt + 3_600_000);
        const stored = JSON.stringify(rows);
        for (const secret of SIGN_IN_SECRETS) {
          assert.ok(!saved.text.includes(secret));
          assert.ok(!stored.includes(secret));
          assert.ok(logged.every((line) => !line.includes(secret)));
        }
      }),
  );

  it.effect(
    "a desktop's Sign in with ChatGPT against OpenAI's authorization server, for the host the service named, is kept as the account's ChatGPT plan",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        // The service checks the ID token against the keys the fake OpenAI publishes.
        const { owner, ask } = yield* openAccounts({
          ring: KEK.ONE,
          auth: (incoming) => signingKeysAnswer(incoming.url) ?? openAiAuth()(incoming),
        });
        const { extAgentHostId } = readHost((yield* ask(request(owner, { path: HOST_PATH }))).body);
        const openai = fakeChatGptAuthorizationServer();
        const opened = yield* Deferred.make<URL>();
        const database = yield* Effect.context<Database | SqlClient.SqlClient>();
        // The desktop's own sign-in, its save the service's own route, as the host posts it.
        const signIn = chatGptSignIn<ProviderKeysAnswer>({
          openConsent: loopbackConsent,
          openExternal: (url) => {
            Deferred.doneUnsafe(opened, Exit.succeed(openai.authorize(url)));
          },
          http: openai.http,
        });
        const save = (credentials: ChatGptCredentialsSaveRequest) =>
          Effect.map(
            ask(
              request(owner, {
                method: "PUT",
                path: CREDENTIALS_PATH,
                body: { ...credentials, scopes: [...credentials.scopes] },
              }),
            ),
            keysOf,
          ).pipe(Effect.provideContext(database));

        const running = yield* Effect.forkChild(signIn.signIn({ extAgentHostId, save }));
        const page = yield* Deferred.await(opened);
        yield* Effect.orDie(returnToLoopback(page, grantedCallback(page)));
        const kept = yield* Fiber.join(running);

        assert.equal(page.searchParams.get("ext_agent_host_id"), extAgentHostId);
        assert.ok(!("reason" in kept), "the sign-in was kept");
        assert.equal(kept.subscriptions?.[0]?.kind, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        const rows = yield* listProviderKeyRows(owner, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.status, PROVIDER_KEY_STATUS.UNVERIFIED);
        const stored = JSON.stringify(
          yield* db.select().from(accountProviderKey).where(eq(accountProviderKey.userId, owner)),
        );
        for (const secret of [CHATGPT_FAKE.ACCESS_TOKEN, CHATGPT_FAKE.REFRESH_TOKEN]) {
          assert.ok(!stored.includes(secret), "the row holds the sign-in sealed");
        }
      }),
  );

  it.effect(
    "a sign-in without the plan's scope, one under the registration client, and a pasted one keep nothing and say why; one beside an OpenAI API key stands beside it",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts({ ring: KEK.ONE });
        const noUsage = keysOf(
          yield* ask(saveSignIn(owner, { scopes: ["openid", "offline_access"] })),
        );
        const registrationClient = keysOf(
          yield* ask(saveSignIn(owner, { clientId: "dynamic_agent_client" })),
        );
        const pasted = keysOf(
          yield* ask(
            request(owner, {
              method: "PUT",
              body: {
                provider: PROVIDER_KEY_PROVIDER.OPENAI,
                key: SIGN_IN.refreshToken,
                kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
              },
            }),
          ),
        );
        keysOf(yield* ask(save(owner, PROVIDER_KEY_PROVIDER.OPENAI, KEY.OPENAI)));
        const besideKey = keysOf(yield* ask(saveSignIn(owner)));

        assert.deepEqual(
          [noUsage, registrationClient, pasted].map((answered) => [
            answered.rejected,
            answered.subscriptions,
          ]),
          [
            [PROVIDER_KEY_REJECTION.INVALID, undefined],
            [PROVIDER_KEY_REJECTION.INVALID, undefined],
            [PROVIDER_KEY_REJECTION.INVALID, undefined],
          ],
        );
        assert.equal(besideKey.rejected, undefined);
        assert.equal(besideKey.keys.length, 1);
        assert.deepEqual(
          besideKey.subscriptions?.map(({ kind }) => kind),
          [PROVIDER_KEY_KIND.CHATGPT_OAUTH],
        );
      }),
  );

  it.effect(
    "the account's ChatGPT host id is minted on its first read, the same on every read after, and its own",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts({ ring: KEK.ONE });
        const read = (userId: string) =>
          Effect.map(ask(request(userId, { path: HOST_PATH })), (answered) => {
            assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
            return readHost(answered.body).extAgentHostId;
          });

        const first = yield* read(owner);
        const again = yield* read(owner);
        const others = yield* read(other);

        assert.match(first, /^urn:uuid:[0-9a-f-]{36}$/u);
        assert.equal(again, first);
        assert.notEqual(others, first);
      }),
  );

  it.effect(
    "removing the ChatGPT sign-in revokes its refresh token at OpenAI first and answers whether OpenAI confirmed it",
    () =>
      Effect.gen(function* () {
        let revocationStatus: number = HTTP_STATUS.OK;
        const { owner, ask, checks } = yield* openAccounts({
          ring: KEK.ONE,
          auth: (incoming) =>
            incoming.url === REVOCATION_URL
              ? new Response(null, { status: revocationStatus })
              : openAiAuth()(incoming),
        });
        keysOf(yield* ask(saveSignIn(owner)));

        const removed = keysOf(yield* ask(removeSignIn(owner)));
        const revocation = checks.find((check) => check.url === REVOCATION_URL);
        const form = new URLSearchParams(
          yield* Effect.promise(() => new Response(revocation?.init.body).text()),
        );

        assert.deepEqual(removed, { keys: [] });
        assert.deepEqual(
          [form.get("token"), form.get("token_type_hint"), form.get("client_id")],
          [SIGN_IN.refreshToken, "refresh_token", SIGN_IN.clientId],
        );

        keysOf(yield* ask(saveSignIn(owner)));
        revocationStatus = HTTP_STATUS.BAD_REQUEST;
        assert.deepEqual(keysOf(yield* ask(removeSignIn(owner))), {
          keys: [],
          revocationUnconfirmed: true,
        });
      }),
  );

  it.effect(
    "a sign-in whose ID token OpenAI did not sign for its issued client, has expired, or names another account keeps nothing and says it is unverified",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts({ ring: KEK.ONE });
        yield* TestClock.adjust("1 day");
        const withToken = (idToken: string, overrides: Record<string, WireBoundaryInput> = {}) =>
          Effect.map(ask(saveSignIn(owner, { idToken, ...overrides })), keysOf);

        const refused = [
          yield* withToken(signedJwt(ID_CLAIMS, FORGED_KEY)),
          yield* withToken(signedJwt({ ...ID_CLAIMS, aud: "oaiapp_another_client" }, OPENAI_KEY)),
          yield* withToken(signedJwt({ ...ID_CLAIMS, iss: "https://issuer.test" }, OPENAI_KEY)),
          yield* withToken(signedJwt({ ...ID_CLAIMS, exp: 60 }, OPENAI_KEY)),
          yield* withToken(signedJwt(ID_CLAIMS, OPENAI_KEY), { accountId: "another-subject" }),
          yield* withToken(signedJwt(ID_CLAIMS, { ...OPENAI_KEY, kid: "unpublished" })),
          yield* withToken("not-a-jwt-000000000000000000000000000"),
        ];

        assert.deepEqual(
          refused.map((answered) => [answered.rejected, answered.subscriptions]),
          refused.map(() => [PROVIDER_KEY_REJECTION.UNVERIFIED_SIGN_IN, undefined]),
        );
        // An audience listing the issued client among others is the issued client's.
        const listed = yield* withToken(
          signedJwt({ ...ID_CLAIMS, aud: ["oaiapp_another_client", ISSUED_CLIENT] }, OPENAI_KEY),
        );
        assert.equal(listed.rejected, undefined);
      }),
  );

  it.effect(
    "a sign-in is checked against OpenAI's keys as they are published now, and one whose keys cannot be read keeps nothing and may be tried again",
    () =>
      Effect.gen(function* () {
        let published = [OPENAI_KEY];
        let reachable = true;
        const { owner, ask } = yield* openAccounts({
          ring: KEK.ONE,
          auth: (incoming) =>
            reachable
              ? openAiAuth(published)(incoming)
              : jsonResponse({}, HTTP_STATUS.SERVER_ERROR),
        });

        assert.equal(keysOf(yield* ask(saveSignIn(owner))).rejected, undefined);
        // OpenAI rotates its key: a token signed by the new one is checked against the keys read anew.
        published = [ROTATED_KEY];
        const rotated = keysOf(
          yield* ask(saveSignIn(owner, { idToken: signedJwt(ID_CLAIMS, ROTATED_KEY) })),
        );
        assert.equal(rotated.rejected, undefined);

        reachable = false;
        const unreachable = keysOf(
          yield* ask(
            saveSignIn(owner, { idToken: signedJwt(ID_CLAIMS, { ...OPENAI_KEY, kid: "next" }) }),
          ),
        );
        assert.equal(unreachable.rejected, PROVIDER_KEY_REJECTION.UNREACHABLE);
      }),
  );

  it.effect(
    "a sign-in whose access token names another client, audience or issuer, or is no JWT, keeps nothing and says it is unverified, though its claims are read unsigned",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts({ ring: KEK.ONE });
        const withAccess = (overrides: Record<string, WireBoundaryInput>) =>
          Effect.map(ask(saveSignIn(owner, overrides)), keysOf);

        const refused = [
          // An access token another client's, for another audience, from another issuer, or no JWT, is no part of this sign-in.
          yield* withAccess({
            accessToken: unsignedJwt({ ...ACCESS_CLAIMS, client_id: "oaiapp_another_client" }),
          }),
          yield* withAccess({
            accessToken: unsignedJwt({ ...ACCESS_CLAIMS, aud: "https://elsewhere.test/v1" }),
          }),
          yield* withAccess({
            accessToken: unsignedJwt({ ...ACCESS_CLAIMS, iss: "https://issuer.test" }),
          }),
          yield* withAccess({
            accessToken: "opaque-access-token-00000000000000000000",
          }),
        ];

        assert.deepEqual(
          refused.map((answered) => [answered.rejected, answered.subscriptions]),
          refused.map(() => [PROVIDER_KEY_REJECTION.UNVERIFIED_SIGN_IN, undefined]),
        );
        // An audience listing OpenAI's API among others is OpenAI's API's.
        const listed = yield* withAccess({
          accessToken: unsignedJwt({ ...ACCESS_CLAIMS, aud: ["https://api.openai.com/v1", "x"] }),
        });
        assert.equal(listed.rejected, undefined);
      }),
  );
});
