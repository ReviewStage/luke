import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import { openHostedStoreTestDatabase, startTask } from "@luke/database/testing";
import { noDatabase } from "@luke/database/testing/no-database";
import { VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@luke/features";
import { LIVE_VOICE } from "@luke/live";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_HEADER } from "@luke/service/agents/brain-host/bounds";
import { CRON_ENVIRONMENT } from "@luke/service/maintenance/maintenance-bounds";
import { sessionStarted } from "@luke/service/testing/live-events";
import {
  connect,
  fakeAccounts,
  send,
  sendText,
  startFakeOpenAi,
} from "@luke/service/testing/voice-fakes";
import type { AttachedSession } from "@luke/service/voice/live-exchange";
import { listening, VoiceService, voiceServer } from "@luke/service/voice/service";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Cause, Deferred, Effect, Exit, Scope } from "effect";
import { afterAll, afterEach, test, vi } from "vitest";
import { voiceFunctionOptions } from "../server/voice/function";

/**
 * The route's own composition passes the exchange. #1209 landed the attach
 * behind a seam `voice/function.ts` did not pass, so that an inertness test
 * could not read as coverage of the live path; this is the sibling it asked
 * for: the options the function builds the service from carry an exchange,
 * and the sessions function's bundle reaches the exchange's own modules, the
 * live-session door among them, which the guard once measured it did not.
 * The desktop half of the same commit, that the host composes no exchange of
 * its own, is held by `@luke/voice`'s holder tests and `@luke/host`'s
 * assembly, which stands with no live brain and no live record to provide.
 *
 * That exchange reaches eve as the deployment under the deployment's own
 * secret at eve's door, read from the function's environment: a deployment
 * holding the cron's `CRON_SECRET` alone, or an `EVE_DEPLOYMENT_SECRET` that
 * is the cron's own value, stands no exchange and every session is refused;
 * one holding its own secret, beside the cron's, asks eve under that secret
 * alone for the account the call is for, from the call's very start, when
 * the plan's first call explores it. OpenAI is a fake on loopback, eve a
 * fake at the exchange's HTTP boundary, and the store PGlite. Synthetic
 * accounts and secrets.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

afterEach(() => {
  vi.unstubAllEnvs();
});

const CRON_SECRET = "cron-secret-1";
const EVE_DEPLOYMENT_SECRET = "eve-deployment-secret-1";
const EVE_ORIGIN = "https://eve.test";
/** The words the exchange refuses with where it has no secret to stand under (`voice/deployment-exchange.ts`). */
const UNCONFIGURED = "the deployment secret is not configured";
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

/** One request eve received: its route, its method, its bearer, and the account it named. */
interface AskedOfEve {
  readonly url: string;
  readonly method: string | undefined;
  readonly authorization: string | null;
  readonly account: string | null;
}

// SAFETY: the exchange reads nothing of a session before its own configuration stands, which is
// as far as the refusals below go, so no field beyond these is read.
const SESSION = {
  accountId: "user-a",
  sessionId: "session-1",
  taskId: "task-1",
  started: false,
} as unknown as AttachedSession;

/** The function's environment holding eve's origin and the two secrets given. */
function stubSecrets(secrets: {
  readonly cron: string | undefined;
  readonly eve: string | undefined;
}) {
  vi.stubEnv(BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN, EVE_ORIGIN);
  vi.stubEnv(CRON_ENVIRONMENT.CRON_SECRET, secrets.cron);
  vi.stubEnv(BRAIN_HOST_ENVIRONMENT.DEPLOYMENT_SECRET, secrets.eve);
}

/** Why the voice function's exchange refuses a session, on a deployment whose environment holds the two secrets given. */
const refusalUnder = (secrets: {
  readonly cron: string | undefined;
  readonly eve: string | undefined;
}) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => stubSecrets(secrets));
    const { exchange } = voiceFunctionOptions(voiceServer());
    assert.ok(exchange);
    const attached = yield* Effect.exit(
      Effect.scoped(exchange(SESSION)).pipe(Effect.provide(noDatabase)),
    );
    return Exit.isFailure(attached) ? String(Cause.squash(attached.cause)) : "stood";
  });

test("the voice function's options carry the exchange", () => {
  const options = voiceFunctionOptions(voiceServer());
  assert.notEqual(options.exchange, undefined);
});

it.effect(
  "the voice function's exchange stands under nothing where the deployment holds the cron's secret alone, or an eve secret that is the cron's own value",
  () =>
    Effect.gen(function* () {
      const cronAlone = yield* refusalUnder({ cron: CRON_SECRET, eve: undefined });
      const shared = yield* refusalUnder({ cron: CRON_SECRET, eve: ` ${CRON_SECRET} ` });
      assert.ok(cronAlone.includes(UNCONFIGURED), cronAlone);
      assert.ok(shared.includes(UNCONFIGURED), shared);
    }),
);

it.effect(
  "a call's exchange, as the voice function composes it, asks eve under EVE_DEPLOYMENT_SECRET for the calling account, never under the cron's secret beside it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.sync(() => stubSecrets({ cron: CRON_SECRET, eve: EVE_DEPLOYMENT_SECRET }));
        const userId = yield* Effect.promise(() => database.createUser());
        const task = yield* Effect.promise(() =>
          database.run(startTask(userId, { name: "Teammate invitations" })),
        );
        const openAi = yield* Effect.acquireRelease(
          Effect.promise(() => startFakeOpenAi()),
          (fake) => Effect.promise(() => fake.close()),
        );
        // The first request eve receives, which the test waits on rather than polling for; eve
        // declines the explore, so nothing follows it.
        const firstAsk = Deferred.makeUnsafe<AskedOfEve>();
        const httpClient = fakeHttpClientLayer((url, init) => {
          const headers = new Headers(init.headers);
          Deferred.doneUnsafe(
            firstAsk,
            Effect.succeed({
              url,
              method: init.method,
              authorization: headers.get("authorization"),
              account: headers.get(BRAIN_HOST_HEADER.ACCOUNT),
            }),
          );
          return new Response(null, { status: 502 });
        });

        const voice = voiceServer();
        const scope = yield* Effect.acquireRelease(
          Effect.promise(() => database.run(Scope.make())),
          (made) => Effect.promise(() => database.run(Scope.close(made, Exit.void))),
        );
        const port = yield* Effect.promise(() =>
          database.run(
            Scope.provide(
              Effect.gen(function* () {
                const listener = yield* listening(voice, 0, "127.0.0.1");
                yield* VoiceService.make({
                  ...voiceFunctionOptions(voice, { httpClient }),
                  apiKey: "sk-test-project-key",
                  accounts: { ...fakeAccounts(), resolveUserId: () => Effect.succeedSome(userId) },
                  record: voiceSessionRecord(),
                  avatar: undefined,
                  openAiBaseUrl: openAi.baseUrl,
                  log: () => undefined,
                });
                return listener;
              }),
              scope,
            ),
          ),
        );
        const opened = yield* Effect.promise(() =>
          connect(`ws://127.0.0.1:${port}${VOICE_SERVICE_PATH.SESSIONS}`, {
            authorization: "Bearer account-token-1",
          }),
        );
        assert.ok("reader" in opened);
        yield* Effect.promise(() =>
          send(opened.reader.socket, {
            type: VOICE_SERVICE_FRAME.SESSION_CREATE,
            sdp: SDP_OFFER,
            voice: LIVE_VOICE.MARIN,
            input: [],
            planId: task.id,
          }),
        );
        const attach = yield* Effect.promise(() => openAi.nextAttach());
        const created = yield* Effect.promise(() => opened.reader.next());
        assert.equal(JSON.parse(created).type, VOICE_SERVICE_FRAME.SESSION_CREATED);
        // The session starting sets the plan's first call exploring, which the exchange opens at eve.
        yield* Effect.promise(() =>
          sendText(attach.socket, JSON.stringify(sessionStarted(attach.sessionId))),
        );

        assert.deepEqual(yield* Deferred.await(firstAsk), {
          url: `${EVE_ORIGIN}/eve/v1/session`,
          method: "POST",
          authorization: `Bearer ${EVE_DEPLOYMENT_SECRET}`,
          account: userId,
        });
      }),
    ),
);
