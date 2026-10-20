import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@luke/database/testing/no-database";
import { BRAIN_HOST_ENVIRONMENT } from "@luke/service/agents/brain-host/bounds";
import { CRON_ENVIRONMENT } from "@luke/service/maintenance/maintenance-bounds";
import type { AttachedSession } from "@luke/service/voice/live-exchange";
import { voiceServer } from "@luke/service/voice/service";
import { Cause, Effect, Exit } from "effect";
import { afterEach, test, vi } from "vitest";
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
 * is the cron's own value, stands no exchange and every session is refused,
 * and one holding its own secret gets past its configuration to the session
 * itself, which these tests' store refuses to open. Synthetic secrets.
 */

const CRON_SECRET = "cron-secret-1";
/** The words the exchange refuses with where it has no secret to stand under (`voice/deployment-exchange.ts`). */
const UNCONFIGURED = "the deployment secret is not configured";

// SAFETY: the exchange reads nothing of a session before its own configuration stands, and past it
// opens the session's conversation from a store these tests refuse, so no field beyond these is read.
const SESSION = {
  accountId: "user-a",
  sessionId: "session-1",
  taskId: "task-1",
  started: false,
} as unknown as AttachedSession;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** What the voice function's exchange answers a session with, on a deployment whose environment holds the two secrets given. */
const exchangeUnder = (secrets: {
  readonly cron: string | undefined;
  readonly eve: string | undefined;
}) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      vi.stubEnv(BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN, "https://luke.test");
      vi.stubEnv(CRON_ENVIRONMENT.CRON_SECRET, secrets.cron);
      vi.stubEnv(BRAIN_HOST_ENVIRONMENT.DEPLOYMENT_SECRET, secrets.eve);
    });
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
  "the voice function's exchange stands under EVE_DEPLOYMENT_SECRET alone: the cron's secret, alone or as the eve secret's value, stands it under nothing",
  () =>
    Effect.gen(function* () {
      const cronAlone = yield* exchangeUnder({ cron: CRON_SECRET, eve: undefined });
      const shared = yield* exchangeUnder({ cron: CRON_SECRET, eve: ` ${CRON_SECRET} ` });
      const own = yield* exchangeUnder({ cron: CRON_SECRET, eve: "eve-deployment-secret-1" });
      assert.ok(cronAlone.includes(UNCONFIGURED), cronAlone);
      assert.ok(shared.includes(UNCONFIGURED), shared);
      assert.equal(own.includes(UNCONFIGURED), false, own);
    }),
);
