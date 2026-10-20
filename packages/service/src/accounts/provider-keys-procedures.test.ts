import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import {
  FAST_ACCESS,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeysAnswer,
  providerKeysAnswerSchema,
} from "@luke/features/provider-key-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { HTTP_STATUS, jsonResponse, recordingHttpClient } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Cause, Clock, Effect, Layer, Logger, Option, Redacted, Result, Schema } from "effect";
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
  options: { ring?: string; provider?: ProviderAnswers; fast?: FastAnswers } = {},
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
      request.url === FAST_CHECK_URL
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
  init: { method?: string; body?: WireBoundaryInput; query?: string } = {},
) {
  const url = new URL(KEYS_PATH, ORIGIN);
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

const remove = (userId: string, provider: string) =>
  request(userId, { method: "DELETE", query: `provider=${provider}` });

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
          Effect.map(listProviderKeyRows(userId), (rows) =>
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
});
