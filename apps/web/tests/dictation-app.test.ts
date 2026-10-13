import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import type { WireBoundaryInput } from "@sidecar/wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Cause, Clock, Effect, Layer, Logger, Option, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { dictationApp } from "../server/dictation-app";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";

/**
 * A dictated clip answered by the group the way a function answers it, over
 * a real dialect and OpenAI faked at its HTTP door: the clip and its words
 * go to the transcription model on Luke's key, the text comes back, the
 * account's day is metered, and nothing of the clip or the text is logged.
 *
 * Synthetic accounts, bearers, clip bytes, and words throughout.
 */

const ORIGIN = "https://luke.test";
const DICTATION_PATH = "/api/dictation";
const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_KEY = "sk-proj-luke-test-key-000000000000000000dict";

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

/** An account behind its own bearer, the model, and the group answering under the key given. */
const openAccount = (options: { model?: ModelAnswer; key?: string | undefined } = {}) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const model = recordingHttpClient(() => modelResponse(options.model ?? { text: SAID }));
    const logged: string[] = [];
    const app = dictationApp({
      resolveUserId: (incoming) =>
        Effect.succeed(
          Option.fromNullishOr(
            incoming.headers.get("authorization") === `Bearer ${userId}` ? userId : undefined,
          ),
        ),
    });
    const key = "key" in options ? options.key : OPENAI_KEY;
    const ask = (request: Request) => answer(app, request, { key, model: model.layer, logged });
    return { userId, ask, calls: model.requests, logged };
  });

const answer = (
  app: ReturnType<typeof dictationApp>,
  request: Request,
  seams: {
    readonly key: string | undefined;
    readonly model: ReturnType<typeof recordingHttpClient>["layer"];
    readonly logged: string[];
  },
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const environment: HostedEnvironmentValues = {
      ...NO_ENVIRONMENT,
      openAiKey: seams.key === undefined ? undefined : Redacted.make(seams.key),
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
      seams.model,
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
    return { status: response.status, body } satisfies Answer;
  });

function clipRequest(
  userId: string | undefined,
  init: { method?: string; body?: WireBoundaryInput; raw?: string } = {},
) {
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return new Request(new URL(DICTATION_PATH, ORIGIN), {
    method: init.method ?? "POST",
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
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
    "a clip is sent to the transcription model with its words on Luke's key, and answered with what it said",
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
      for (const secret of [SAID, CLIP_BASE64, OPENAI_KEY, ...KEYWORDS]) {
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
});
