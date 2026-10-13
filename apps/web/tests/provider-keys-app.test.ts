import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { accountProviderKey } from "@sidecar/database/schemas/account-provider-key";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeysAnswer,
  providerKeysAnswerSchema,
} from "@sidecar/hosted/provider-key-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { HTTP_STATUS, jsonResponse, recordingHttpClient } from "@sidecar/wire/testing";
import { eq } from "drizzle-orm";
import { Cause, Clock, Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { providerKeysApp } from "../server/provider-keys-app";

/**
 * The account's own provider keys, answered by the group the way a function
 * answers them, over a real dialect and a provider faked at its HTTP door:
 * a key is kept only once its provider accepts it, kept sealed, answered
 * only as a hint, and never logged; the bearer names the account and
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

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
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

/** Two accounts behind their own bearers, a provider, and the group answering under the ring given. */
const openAccounts = (options: { ring?: string; provider?: ProviderAnswers } = {}) =>
  Effect.gen(function* () {
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
      jsonResponse({}, answers.get(keyOf(request.headers)) ?? HTTP_STATUS.UNAUTHORIZED),
    );
    const logged: string[] = [];
    const app = providerKeysApp({
      resolveUserId: (incoming) =>
        Effect.succeed(
          Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
        ),
    });
    const ask = (request: Request, ring = options.ring) =>
      answer(app, request, { ring, provider: provider.layer, logged });
    return { owner, other, ask, checks: provider.requests, logged };
  });

const answer = (
  app: ReturnType<typeof providerKeysApp>,
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
    // The handler runs on the router's own fiber, so it is handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, environment),
      seams.provider,
      Logger.layer([recorder]),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      app.pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
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
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
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
          checks.map((check) => [check.url, keyOf(check.headers)]),
          [[PROVIDER_URL[PROVIDER_KEY_PROVIDER.ANTHROPIC], KEY.ANTHROPIC]],
          "the provider is asked once, with the key",
        );
      }),
  );

  it.effect("no column of the row holds the key, or its base64, in the clear", () =>
    Effect.gen(function* () {
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

        assert.deepEqual(keysOf(invalid), { keys: [], rejected: PROVIDER_KEY_REJECTION.INVALID });
        assert.deepEqual(keysOf(unreachable), {
          keys: [],
          rejected: PROVIDER_KEY_REJECTION.UNREACHABLE,
        });
        assert.deepEqual(keysOf(misplaced), {
          keys: [],
          rejected: PROVIDER_KEY_REJECTION.WRONG_PROVIDER,
        });
        assert.ok(
          checks.every((check) => keyOf(check.headers) !== KEY.ANTHROPIC),
          "an Anthropic key is never sent to OpenAI",
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
});
