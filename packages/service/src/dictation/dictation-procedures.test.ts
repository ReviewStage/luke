import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import type { WireBoundaryInput } from "@luke/wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { Cause, type Context, Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { dictationProcedures } from "./dictation-procedures.js";

/**
 * A dictated clip answered by the hosted oRPC router the way the web route answers it, over
 * a real dialect and OpenAI faked at its HTTP door: the clip and its words
 * go to the transcription model on the account's own OpenAI key, never
 * Luke's, the text comes back, the account's day is metered, and nothing of
 * the clip or the text is logged. An account with no key of its own is
 * refused as missing one, though the deployment still holds a key of Luke's.
 *
 * Synthetic accounts, bearers, clip bytes, and words throughout.
 */

const ORIGIN = "https://luke.test";
const DICTATION_PATH = "/api/dictation";
const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_KEY = "sk-proj-account-test-key-0000000000000dict";
/** A key of Luke's the deployment still holds, which no clip is ever sent on. */
const LUKE_OPENAI_KEY = "sk-proj-luke-test-key-000000000000000000dict";
/** The deployment's ring the account's key is sealed under: fixed bytes written for this file. */
const RING = `1:${Buffer.alloc(32, 3).toString("base64")}`;

/** Bytes that stand for a clip; the fake reads them back rather than hearing them. */
const CLIP = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);
const CLIP_BASE64 = Buffer.from(CLIP).toString("base64");

const SAID = "Run pnpm install in apps/web, then open useEffect.";
const KEYWORDS = ["luke", "Composer dictation", "apps/web/server/dictation-app.ts"];

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
}

/** How the fake model answers: the words, with the seconds it billed where given, or a status of its own. */
type ModelAnswer =
  | { readonly text: string; readonly seconds?: number }
  | { readonly status: number }
  | { readonly unreachable: true };

function modelResponse(answer: ModelAnswer): Response {
  if ("unreachable" in answer) throw new Error("connection refused");
  if ("status" in answer) return jsonResponse({ error: { message: SAID } }, answer.status);
  const usage =
    answer.seconds === undefined ? undefined : { type: "duration", seconds: answer.seconds };
  return jsonResponse({
    text: answer.text,
    languages: ["en"],
    ...(usage === undefined ? undefined : { usage }),
  });
}

/** The account's own OpenAI API key, sealed under the test's ring and saved as Settings saves one. */
const saveOwnKey = (userId: string, key: string) =>
  Effect.gen(function* () {
    const ring = parseKeyRing(Redacted.make(RING));
    assert.ok(Result.isSuccess(ring));
    const owner = {
      userId,
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      kind: PROVIDER_KEY_KIND.API_KEY,
    } as const;
    yield* saveProviderKey(
      userId,
      owner.provider,
      owner.kind,
      sealProviderKey(ring.success, owner, Redacted.make(key)),
      "sk-…dict",
      null,
      new Date(0),
    );
  });

/** An account behind its own bearer, with its own key saved where one is given, the model, and the group answering. */
const openAccount = (options: { model?: ModelAnswer; key?: string | undefined } = {}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const model = recordingHttpClient(() => modelResponse(options.model ?? { text: SAID }));
    const logged: string[] = [];
    const procedures = dictationProcedures({
      resolveUserId: (incoming) =>
        Effect.succeed(
          Option.fromNullishOr(
            incoming.headers.get("authorization") === `Bearer ${userId}` ? userId : undefined,
          ),
        ),
    });
    const key = "key" in options ? options.key : OPENAI_KEY;
    if (key !== undefined) yield* saveOwnKey(userId, key);
    const ask = (request: Request) => answer(procedures, request, { model: model.layer, logged });
    return { userId, ask, calls: model.requests, logged };
  });

const answer = (
  procedures: ReturnType<typeof dictationProcedures>,
  request: Request,
  seams: {
    readonly model: ReturnType<typeof recordingHttpClient>["layer"];
    readonly logged: string[];
  },
) =>
  Effect.gen(function* () {
    const environment: HostedEnvironmentValues = {
      ...NO_ENVIRONMENT,
      openAiKey: Redacted.make(LUKE_OPENAI_KEY),
      providerKeyEncryptionKeys: Redacted.make(RING),
    };
    // Every line the procedure logs is kept, so the test can read what it says.
    const recorder = Logger.make(({ message, cause }) => {
      seams.logged.push(`${JSON.stringify(message)} ${Cause.pretty(cause)}`);
    });
    // The procedure runs on the services handed to it: the test's own, with the key, the model, and the recorder beside them.
    const services = yield* Effect.context<never>().pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(HostedEnvironment, environment),
          seams.model,
          Logger.layer([recorder]),
        ),
      ),
    );
    // SAFETY: the dictation procedure yields the database, the clock, the environment, and the model's HTTP client alone, which the context above holds.
    const webServices = services as Context.Context<WebServices>;
    const response = yield* Effect.promise(() =>
      hostedFetch({ dictation: procedures })(request, webServices),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function clipRequest(
  userId: string | undefined,
  init: { method?: string; body?: WireBoundaryInput; raw?: string } = {},
) {
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return new Request(new URL(DICTATION_PATH, ORIGIN), {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
    },
    ...(body === undefined ? undefined : { body }),
  });
}

const clip = (userId: string | undefined, fields: Record<string, WireBoundaryInput> = {}) =>
  clipRequest(userId, {
    body: { audio: CLIP_BASE64, durationMs: 9_000, keywords: KEYWORDS, ...fields },
  });

/** The form the model was sent, failing the test where it was sent none. */
function formOf(call: RecordedRequest): FormData {
  const body = call.init.body;
  assert.ok(body instanceof FormData, "the clip goes as a multipart form");
  return body;
}

const refusal = (status: number, error: string) => ({ status, body: { error } });

it.layer(getTestDB())("the dictation route", (it) => {
  it.effect(
    "a clip is sent to the transcription model with its words on the account's own key, and answered with what it said",
    () =>
      Effect.gen(function* () {
        const { userId, ask, calls } = yield* openAccount();

        const answered = yield* ask(clip(userId));

        assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { text: SAID } });
        assert.equal(calls.length, 1);
        const [call] = calls;
        assert.ok(call);
        assert.equal(call.method, "POST");
        assert.equal(call.url, TRANSCRIPTIONS_URL);
        assert.equal(call.authorization, `Bearer ${OPENAI_KEY}`);
        const form = formOf(call);
        assert.equal(form.get("model"), "gpt-transcribe");
        assert.deepEqual(form.getAll("keywords[]"), KEYWORDS);
        const file = form.get("file");
        assert.ok(file instanceof File);
        assert.equal(file.type, "audio/webm");
        assert.deepEqual(new Uint8Array(yield* Effect.promise(() => file.arrayBuffer())), CLIP);
      }),
  );

  it.effect("nothing of the clip, its words, or the key is logged", () =>
    Effect.gen(function* () {
      const { userId, ask, logged } = yield* openAccount({
        model: { status: HTTP_STATUS.SERVER_ERROR },
      });
      yield* ask(clip(userId));

      assert.ok(logged.length > 0, "the failure is logged");
      for (const secret of [SAID, CLIP_BASE64, OPENAI_KEY, LUKE_OPENAI_KEY, ...KEYWORDS]) {
        assert.ok(logged.every((line) => !line.includes(secret)));
      }
    }),
  );

  it.effect(
    "a request without the account's bearer, or by another method, is refused unheard",
    () =>
      Effect.gen(function* () {
        const { userId, ask, calls } = yield* openAccount();

        const anonymous = yield* ask(clip(undefined));
        const stranger = yield* ask(clip(`user-${randomUUID()}`));
        const read = yield* ask(clipRequest(userId, { method: "GET" }));

        const unauthorized = refusal(
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_API_ERROR.INVALID_TOKEN,
        );
        assert.deepEqual([anonymous, stranger], [unauthorized, unauthorized]);
        assert.deepEqual(
          read,
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
        assert.equal(calls.length, 0);
      }),
  );

  it.effect(
    "a clip past two minutes is refused as too large, and an account without an OpenAI key of its own is refused as missing one, on no key of Luke's, before the clip is read at all",
    () =>
      Effect.gen(function* () {
        const { userId, ask, calls } = yield* openAccount();
        const keyless = yield* openAccount({ key: undefined });

        const long = yield* ask(clip(userId, { durationMs: 120_001 }));
        const unkeyed = yield* keyless.ask(clipRequest(keyless.userId, { body: { audio: 7 } }));

        assert.deepEqual(
          long,
          refusal(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
        );
        assert.deepEqual(
          unkeyed,
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.OPENAI_KEY_MISSING),
        );
        assert.equal(calls.length + keyless.calls.length, 0);
      }),
  );
});
